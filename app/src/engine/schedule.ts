// Scheduling engine: pure functions, no I/O. Times are epoch milliseconds;
// wall-clock positions are always derived through the user's time zone.
import { addDays, isoWeekday, localDate, MINUTE, zonedToUtc } from '../../../supabase/functions/_shared/tz.ts';

export type Role = 'practicas' | 'work' | 'school' | 'gym' | 'activity' | 'deadlines' | 'main' | 'other';
export type BlockedKind = 'non_school' | 'holiday';

export interface CalendarInfo {
  id: string;
  name: string;
  role: Role;
  color: string;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  countsBusy: boolean;
}

export interface EventInput {
  id: string;
  calendarId: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  eventType: 'event' | 'focus' | 'deadline';
  status: 'confirmed' | 'tentative' | 'cancelled';
}

export interface OverrideInput {
  eventId: string;
  startMs: number | null;
  endMs: number | null;
  cancelled: boolean;
}

export interface TaskInput {
  id: string;
  title: string;
  quadrant: 1 | 2 | 3 | 4;
  day: string | null;
  startMin: number | null;
  durationMin: number;
  done: boolean;
  createdAt: string;
}

export interface PracticasConfig {
  enabled: boolean;
  start: string | null;
  end: string | null;
  weekdays: number[];
  startMin: number;
  endMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  totalHours: number;
}

export interface ScheduleSettings {
  tz: string;
  /** Free time is counted inside [dayStartMin, dayEndMin) of each day. */
  dayStartMin: number;
  dayEndMin: number;
  minSlotMin: number;
  practicas: PracticasConfig;
  blockedDays: ReadonlyMap<string, BlockedKind>;
}

export interface ScheduleData {
  calendars: readonly CalendarInfo[];
  events: readonly EventInput[];
  overrides: readonly OverrideInput[];
  tasks: readonly TaskInput[];
}

export type BlockKind = 'event' | 'focus' | 'practicas' | 'task' | 'buffer' | 'free';

export interface Block {
  kind: BlockKind;
  startMs: number;
  endMs: number;
  title: string;
  color?: string;
  calendarId?: string;
  eventId?: string;
  taskId?: string;
  moved?: boolean;
  autoPlaced?: boolean;
}

export interface DayPlan {
  date: string;
  /** Displayed column: dayStart to 02:00 the next day. */
  displayStartMs: number;
  displayEndMs: number;
  /** Counted window: dayStart to dayEnd (00:00). */
  windowStartMs: number;
  windowEndMs: number;
  busy: Block[];
  buffers: Block[];
  free: Block[];
  /** All-day items, deadlines and other non-blocking items of the day. */
  notes: Block[];
  cancelled: Block[];
  freeTotalMin: number;
  longestFreeMin: number;
  busyTotalMin: number;
  nextFree: Block | null;
  practicasBlocked: BlockedKind | null;
}

export interface Interval {
  startMs: number;
  endMs: number;
}

export const DISPLAY_END_MIN = 1440 + 120; // 02:00 the next day
export const AUTO_PLACE_HORIZON_MS = 48 * 60 * MINUTE;

/** Sort and merge overlapping or touching intervals. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((i) => i.endMs > i.startMs).sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startMs <= last.endMs) last.endMs = Math.max(last.endMs, i.endMs);
    else out.push({ startMs: i.startMs, endMs: i.endMs });
  }
  return out;
}

/** Parts of `range` not covered by `busy` (busy must be merged). */
export function subtract(range: Interval, busy: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let cursor = range.startMs;
  for (const b of busy) {
    if (b.endMs <= cursor) continue;
    if (b.startMs >= range.endMs) break;
    if (b.startMs > cursor) out.push({ startMs: cursor, endMs: Math.min(b.startMs, range.endMs) });
    cursor = Math.max(cursor, b.endMs);
    if (cursor >= range.endMs) break;
  }
  if (cursor < range.endMs) out.push({ startMs: cursor, endMs: range.endMs });
  return out;
}

function clip(i: Interval, r: Interval): Interval | null {
  const s = Math.max(i.startMs, r.startMs);
  const e = Math.min(i.endMs, r.endMs);
  return e > s ? { startMs: s, endMs: e } : null;
}

const minutes = (ms: number) => Math.round(ms / MINUTE);
const overlaps = (i: Interval, r: Interval) => i.endMs > r.startMs && i.startMs < r.endMs;

/** Same weekday and not blocked: a working day, ignoring the period bounds. */
function practicasWorkday(date: string, s: ScheduleSettings): { on: boolean; blocked: BlockedKind | null } {
  if (!s.practicas.weekdays.includes(isoWeekday(date))) return { on: false, blocked: null };
  const blocked = s.blockedDays.get(date) ?? null;
  return { on: !blocked, blocked };
}

const MAX_PRACTICAS_DAYS = 3 * 366;
const endCache = new WeakMap<ScheduleSettings, string | null>();

/**
 * Last prácticas day. A fixed end date wins; otherwise it is the day on which
 * the cumulative hours (working weekdays, blocked days skipped) reach the target.
 */
export function practicasEnd(s: ScheduleSettings): string | null {
  const p = s.practicas;
  if (!p.enabled || !p.start) return null;
  if (p.end) return p.end;
  if (endCache.has(s)) return endCache.get(s)!;
  const perDay = (p.endMin - p.startMin) / 60;
  let end: string | null = null;
  if (perDay > 0 && p.weekdays.length > 0 && p.totalHours > 0) {
    let hours = 0;
    let d = p.start;
    for (let i = 0; i < MAX_PRACTICAS_DAYS; i++, d = addDays(d, 1)) {
      if (!practicasWorkday(d, s).on) continue;
      hours += perDay;
      if (hours >= p.totalHours) {
        end = d;
        break;
      }
    }
  }
  endCache.set(s, end);
  return end;
}

/** Is `date` a prácticas day? Returns the blocking reason when it is excluded by a blocked day. */
export function practicasDay(date: string, s: ScheduleSettings): { on: boolean; blocked: BlockedKind | null } {
  const p = s.practicas;
  const end = practicasEnd(s);
  if (!p.enabled || !p.start || !end || date < p.start || date > end) return { on: false, blocked: null };
  return practicasWorkday(date, s);
}

/**
 * Prácticas hours: done before `today`, planned over the whole period (the
 * last day is shortened when the target is not a multiple of the daily hours),
 * the target and the last day.
 */
export function practicasHours(
  s: ScheduleSettings,
  today: string,
): { done: number; planned: number; target: number; end: string | null } {
  const p = s.practicas;
  const perDay = (p.endMin - p.startMin) / 60;
  const end = practicasEnd(s);
  let done = 0;
  let planned = 0;
  if (p.enabled && p.start && end) {
    for (let d = p.start; d <= end; d = addDays(d, 1)) {
      if (!practicasDay(d, s).on) continue;
      const hours = p.end ? perDay : Math.min(perDay, p.totalHours - planned);
      planned += hours;
      if (d < today) done += hours;
    }
  }
  return { done, planned, target: p.totalHours, end };
}

function applyOverrides(events: readonly EventInput[], overrides: readonly OverrideInput[]) {
  const byEvent = new Map(overrides.map((o) => [o.eventId, o]));
  const active: (EventInput & { moved: boolean })[] = [];
  const cancelled: EventInput[] = [];
  for (const e of events) {
    if (e.status === 'cancelled') continue;
    const o = byEvent.get(e.id);
    if (o?.cancelled) cancelled.push(e);
    else if (o && o.startMs !== null && o.endMs !== null) active.push({ ...e, startMs: o.startMs, endMs: o.endMs, moved: true });
    else active.push({ ...e, moved: false });
  }
  return { active, cancelled };
}

interface BusySource {
  block: Block;
  bufferBeforeMin: number;
  bufferAfterMin: number;
}

/** Everything that occupies time around `date`, with its buffers. */
function busySources(date: string, data: ScheduleData, s: ScheduleSettings, extraTasks: readonly Block[]): {
  sources: BusySource[];
  notes: Block[];
  cancelled: Block[];
} {
  const calendars = new Map(data.calendars.map((c) => [c.id, c]));
  const around: Interval = {
    startMs: zonedToUtc(date, -6 * 60, s.tz),
    endMs: zonedToUtc(date, DISPLAY_END_MIN + 6 * 60, s.tz),
  };
  const sources: BusySource[] = [];
  const notes: Block[] = [];
  const { active, cancelled } = applyOverrides(data.events, data.overrides);

  for (const e of active) {
    if (!overlaps({ startMs: e.startMs, endMs: Math.max(e.endMs, e.startMs + 1) }, around)) continue;
    const cal = calendars.get(e.calendarId);
    const block: Block = {
      kind: e.eventType === 'focus' ? 'focus' : 'event',
      startMs: e.startMs,
      endMs: e.endMs,
      title: e.title,
      color: cal?.color,
      calendarId: e.calendarId,
      eventId: e.id,
      moved: e.moved,
    };
    const blocking = cal?.countsBusy !== false && !e.allDay && e.eventType !== 'deadline' && e.endMs > e.startMs;
    if (!blocking) {
      notes.push(block);
      continue;
    }
    const practicasRole = cal?.role === 'practicas';
    sources.push({
      block,
      bufferBeforeMin: practicasRole ? s.practicas.bufferBeforeMin : (cal?.bufferBeforeMin ?? 0),
      bufferAfterMin: practicasRole ? s.practicas.bufferAfterMin : (cal?.bufferAfterMin ?? 0),
    });
  }

  // Generated prácticas for the previous, current and next day (buffers can cross midnight).
  for (const d of [addDays(date, -1), date, addDays(date, 1)]) {
    if (!practicasDay(d, s).on) continue;
    sources.push({
      block: {
        kind: 'practicas',
        startMs: zonedToUtc(d, s.practicas.startMin, s.tz),
        endMs: zonedToUtc(d, s.practicas.endMin, s.tz),
        title: 'Prácticas',
      },
      bufferBeforeMin: s.practicas.bufferBeforeMin,
      bufferAfterMin: s.practicas.bufferAfterMin,
    });
  }

  for (const t of data.tasks) {
    if (t.day === null || t.startMin === null) continue;
    const startMs = zonedToUtc(t.day, t.startMin, s.tz);
    const block: Block = { kind: 'task', startMs, endMs: startMs + t.durationMin * MINUTE, title: t.title, taskId: t.id };
    if (overlaps(block, around)) sources.push({ block, bufferBeforeMin: 0, bufferAfterMin: 0 });
  }
  for (const b of extraTasks) {
    if (overlaps(b, around)) sources.push({ block: b, bufferBeforeMin: 0, bufferAfterMin: 0 });
  }

  return {
    sources,
    // Non-blocking items belong to every local day they touch.
    notes: notes.filter(
      (n) => localDate(n.startMs, s.tz) <= date && date <= localDate(Math.max(n.startMs, n.endMs - 1), s.tz),
    ),
    cancelled: cancelled
      .filter((e) => localDate(e.startMs, s.tz) === date)
      .map((e) => ({
        kind: 'event' as const,
        startMs: e.startMs,
        endMs: e.endMs,
        title: e.title,
        color: calendars.get(e.calendarId)?.color,
        calendarId: e.calendarId,
        eventId: e.id,
      })),
  };
}

/** Plan of one day. `extraTasks` are auto-placed task blocks. */
export function buildDay(
  date: string,
  data: ScheduleData,
  s: ScheduleSettings,
  nowMs: number,
  extraTasks: readonly Block[] = [],
): DayPlan {
  const windowR: Interval = { startMs: zonedToUtc(date, s.dayStartMin, s.tz), endMs: zonedToUtc(date, s.dayEndMin, s.tz) };
  const displayR: Interval = { startMs: windowR.startMs, endMs: zonedToUtc(date, DISPLAY_END_MIN, s.tz) };
  const { sources, notes, cancelled } = busySources(date, data, s, extraTasks);

  const occupied = mergeIntervals(sources.map((x) => x.block));
  const bufferRaw: Interval[] = [];
  for (const x of sources) {
    if (x.bufferBeforeMin > 0) bufferRaw.push({ startMs: x.block.startMs - x.bufferBeforeMin * MINUTE, endMs: x.block.startMs });
    if (x.bufferAfterMin > 0) bufferRaw.push({ startMs: x.block.endMs, endMs: x.block.endMs + x.bufferAfterMin * MINUTE });
  }
  const allBusy = mergeIntervals([...occupied, ...bufferRaw]);

  // Buffers are drawn only where nothing else is.
  const buffers: Block[] = [];
  for (const b of mergeIntervals(bufferRaw)) {
    for (const part of subtract(b, occupied)) {
      const c = clip(part, displayR);
      if (c) buffers.push({ kind: 'buffer', ...c, title: 'Trajet' });
    }
  }

  const minSlot = s.minSlotMin * MINUTE;
  const free: Block[] = subtract(windowR, allBusy)
    .filter((f) => f.endMs - f.startMs >= minSlot)
    .map((f) => ({ kind: 'free', ...f, title: '' }));

  const busy = sources
    .map((x) => x.block)
    .filter((b) => overlaps(b, displayR))
    .sort((a, b) => a.startMs - b.startMs);

  const busyTotalMin = allBusy.reduce((sum, i) => {
    const c = clip(i, windowR);
    return sum + (c ? minutes(c.endMs - c.startMs) : 0);
  }, 0);
  const freeTotalMin = free.reduce((sum, f) => sum + minutes(f.endMs - f.startMs), 0);
  const longestFreeMin = free.reduce((m, f) => Math.max(m, minutes(f.endMs - f.startMs)), 0);

  let nextFree: Block | null = null;
  for (const f of free) {
    if (f.endMs <= nowMs) continue;
    const start = Math.max(f.startMs, nowMs);
    if (f.endMs - start >= minSlot) {
      nextFree = { ...f, startMs: start };
      break;
    }
  }

  return {
    date,
    displayStartMs: displayR.startMs,
    displayEndMs: displayR.endMs,
    windowStartMs: windowR.startMs,
    windowEndMs: windowR.endMs,
    busy,
    buffers,
    free,
    notes,
    cancelled,
    freeTotalMin,
    longestFreeMin,
    busyTotalMin,
    nextFree,
    practicasBlocked: practicasDay(date, s).blocked,
  };
}

export interface Placement {
  taskId: string;
  block: Block | null;
}

/**
 * Urgent + important tasks without a time go, oldest first, into the first
 * free slot long enough within the next 48 h. Unplaceable tasks get null.
 */
export function autoPlace(data: ScheduleData, s: ScheduleSettings, nowMs: number): Placement[] {
  const pending = data.tasks
    .filter((t) => t.quadrant === 1 && !t.done && t.startMin === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (pending.length === 0) return [];

  const horizon: Interval = { startMs: nowMs, endMs: nowMs + AUTO_PLACE_HORIZON_MS };
  const today = localDate(nowMs, s.tz);
  const slots: Interval[] = [];
  for (let i = 0; i <= 2; i++) {
    for (const f of buildDay(addDays(today, i), data, s, nowMs).free) {
      const c = clip(f, horizon);
      if (c) slots.push(c);
    }
  }
  // Start on a 5-minute boundary.
  const step = 5 * MINUTE;
  for (const slot of slots) slot.startMs = Math.ceil(slot.startMs / step) * step;

  return pending.map((t) => {
    const need = t.durationMin * MINUTE;
    const slot = slots.find((x) => x.endMs - x.startMs >= need);
    if (!slot) return { taskId: t.id, block: null };
    const block: Block = { kind: 'task', startMs: slot.startMs, endMs: slot.startMs + need, title: t.title, taskId: t.id, autoPlaced: true };
    slot.startMs += need;
    return { taskId: t.id, block };
  });
}

/** Day plan including auto-placed tasks. */
export function planDay(date: string, data: ScheduleData, s: ScheduleSettings, nowMs: number): { plan: DayPlan; placements: Placement[] } {
  const placements = autoPlace(data, s, nowMs);
  const extra = placements.flatMap((p) => (p.block ? [p.block] : []));
  return { plan: buildDay(date, data, s, nowMs, extra), placements };
}
