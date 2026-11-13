// Scheduling engine: pure functions, no I/O. Times are epoch milliseconds;
// wall-clock positions are always derived through the user's time zone.
import { addDays, DAY_MIN, isoWeekday, localDate, MINUTE, zonedToUtc } from '../../../supabase/functions/_shared/tz.ts';

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
  /** Event titles hidden in Huecos (compared with normalizeTitle). */
  hiddenTitles?: readonly string[];
  /** Work needed before each deadline of this calendar (0 = none). */
  deadlineWorkMin?: number;
  /** At most this much work per day for one deadline. */
  deadlineDailyMaxMin?: number;
}

/** Title as compared for hiding: trimmed, spaces collapsed, lower case. */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isHidden(cal: CalendarInfo | undefined, title: string): boolean {
  if (!cal?.hiddenTitles?.length) return false;
  const t = normalizeTitle(title);
  return cal.hiddenTitles.some((h) => normalizeTitle(h) === t);
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
  /** Hours counted per hour worked (1.25: 4 h worked = 5 h logged). */
  hourFactor: number;
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

/** An entry of a manual calendar, repeated on some weekdays between two dates. */
export interface EntryInput {
  id: string;
  calendarId: string;
  title: string;
  startMin: number;
  endMin: number;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: readonly number[];
  startDate: string;
  endDate: string | null;
}

export interface ScheduleData {
  calendars: readonly CalendarInfo[];
  events: readonly EventInput[];
  overrides: readonly OverrideInput[];
  tasks: readonly TaskInput[];
  entries?: readonly EntryInput[];
  /** Deadline event ids marked done: no more work placed for them. */
  doneDeadlines?: readonly string[];
}

export type BlockKind = 'event' | 'focus' | 'practicas' | 'task' | 'buffer' | 'break' | 'free';

export interface Block {
  kind: BlockKind;
  startMs: number;
  endMs: number;
  title: string;
  color?: string;
  calendarId?: string;
  eventId?: string;
  taskId?: string;
  /** Set on occurrences of a manual calendar entry. */
  entryId?: string;
  /** Set on work blocks placed before a deadline (the deadline event id). */
  deadlineId?: string;
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
 * the cumulative logged hours (working weekdays, blocked days skipped, worked
 * hours × hourFactor) reach the target.
 */
export function practicasEnd(s: ScheduleSettings): string | null {
  const p = s.practicas;
  if (!p.enabled || !p.start) return null;
  if (p.end) return p.end;
  if (endCache.has(s)) return endCache.get(s)!;
  const perDay = loggedPerDay(s);
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

/** Hours logged for one full prácticas day. */
export function loggedPerDay(s: ScheduleSettings): number {
  const p = s.practicas;
  return ((p.endMin - p.startMin) / 60) * (p.hourFactor > 0 ? p.hourFactor : 1);
}

/** Is `date` a prácticas day? Returns the blocking reason when it is excluded by a blocked day. */
export function practicasDay(date: string, s: ScheduleSettings): { on: boolean; blocked: BlockedKind | null } {
  const p = s.practicas;
  const end = practicasEnd(s);
  if (!p.enabled || !p.start || !end || date < p.start || date > end) return { on: false, blocked: null };
  return practicasWorkday(date, s);
}

/**
 * Prácticas hours, as logged (worked × hourFactor): done before `today`,
 * planned over the whole period (the last day counts only what is still
 * missing), the target and the last day.
 */
export function practicasHours(
  s: ScheduleSettings,
  today: string,
): { done: number; planned: number; target: number; end: string | null } {
  const p = s.practicas;
  const perDay = loggedPerDay(s);
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
/** Whether a manual entry takes place on a local date. */
export function entryOccurs(entry: EntryInput, date: string): boolean {
  return (
    date >= entry.startDate &&
    (entry.endDate === null || date <= entry.endDate) &&
    entry.weekdays.includes(isoWeekday(date))
  );
}

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
    if (isHidden(cal, e.title)) continue;
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

  // Manual calendar entries of the previous, current and next day (buffers can cross midnight).
  for (const d of [addDays(date, -1), date, addDays(date, 1)]) {
    for (const entry of data.entries ?? []) {
      if (!entryOccurs(entry, d)) continue;
      const cal = calendars.get(entry.calendarId);
      const block: Block = {
        kind: 'event',
        startMs: zonedToUtc(d, entry.startMin, s.tz),
        endMs: zonedToUtc(d, entry.endMin, s.tz),
        title: entry.title,
        color: cal?.color,
        calendarId: entry.calendarId,
        entryId: entry.id,
      };
      if (cal?.countsBusy === false) {
        if (d === date) notes.push(block);
        continue;
      }
      const practicasRole = cal?.role === 'practicas';
      sources.push({
        block,
        bufferBeforeMin: practicasRole ? s.practicas.bufferBeforeMin : (cal?.bufferBeforeMin ?? 0),
        bufferAfterMin: practicasRole ? s.practicas.bufferAfterMin : (cal?.bufferAfterMin ?? 0),
      });
    }
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
      .filter((e) => localDate(e.startMs, s.tz) === date && !isHidden(calendars.get(e.calendarId), e.title))
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

export interface DeadlineWork {
  eventId: string;
  title: string;
  dueMs: number;
  calendarId: string;
  totalMin: number;
  plannedMin: number;
  /** Work that found no free time in the 60 days before the deadline. */
  missingMin: number;
  done: boolean;
}

export interface WorkPlan {
  blocks: Block[];
  deadlines: Map<string, DeadlineWork>;
}

/** How far back from a deadline work may be placed. */
export const DEADLINE_LOOKBACK_DAYS = 60;
/** Smallest piece of deadline work (unless less than that is left for the day). */
export const WORK_CHUNK_MIN = 30;
/** A work block longer than this gets a break in the middle. */
export const LONG_BLOCK_MIN = 240;
export const BREAK_MIN = 20;
const workCache = new WeakMap<ScheduleData, WeakMap<ScheduleSettings, WorkPlan>>();

/**
 * Work before deadlines. For each deadline of a calendar with
 * deadlineWorkMin > 0 (earliest deadline first), the work goes into free time
 * starting the day before the deadline and going back one day at a time, at
 * most deadlineDailyMaxMin per day, earliest free time first inside a day.
 * It does not depend on the current time, so the plan stays put day after
 * day and blocks in the past count as done.
 */
export function deadlineWork(data: ScheduleData, s: ScheduleSettings): WorkPlan {
  let bySettings = workCache.get(data);
  const cached = bySettings?.get(s);
  if (cached) return cached;

  const calendars = new Map(data.calendars.map((c) => [c.id, c]));
  const done = new Set(data.doneDeadlines ?? []);
  const deadlines = applyOverrides(data.events, data.overrides)
    .active.filter((e) => {
      const cal = calendars.get(e.calendarId);
      return e.eventType === 'deadline' && (cal?.deadlineWorkMin ?? 0) > 0 && !isHidden(cal, e.title);
    })
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));

  const blocks: Block[] = [];
  const summary = new Map<string, DeadlineWork>();
  for (const e of deadlines) {
    const cal = calendars.get(e.calendarId)!;
    const totalMin = cal.deadlineWorkMin!;
    const base = { eventId: e.id, title: e.title, dueMs: e.startMs, calendarId: e.calendarId, totalMin };
    if (done.has(e.id)) {
      summary.set(e.id, { ...base, plannedMin: 0, missingMin: 0, done: true });
      continue;
    }
    const dailyMax = Math.max(cal.deadlineDailyMaxMin ?? 120, 15);
    const due = localDate(e.startMs, s.tz);
    let left = totalMin;
    for (let i = 1; i <= DEADLINE_LOOKBACK_DAYS && left > 0; i++) {
      let dayLeft = Math.min(dailyMax, left);
      for (const f of buildDay(addDays(due, -i), data, s, 0, blocks).free) {
        if (dayLeft <= 0) break;
        const room = minutes(f.endMs - f.startMs);
        let chunk = Math.min(room, dayLeft);
        // Over 4 h: keep room for a 20-min break in the middle.
        if (chunk > LONG_BLOCK_MIN) chunk = Math.min(dayLeft, room - BREAK_MIN);
        if (chunk < Math.min(WORK_CHUNK_MIN, dayLeft)) continue;
        const work = (startMs: number, min: number): Block => ({
          kind: 'focus',
          startMs,
          endMs: startMs + min * MINUTE,
          title: e.title,
          color: cal.color,
          calendarId: e.calendarId,
          deadlineId: e.id,
        });
        if (chunk > LONG_BLOCK_MIN) {
          const first = Math.ceil(chunk / 2 / 5) * 5;
          const pauseStart = f.startMs + first * MINUTE;
          const pauseEnd = pauseStart + BREAK_MIN * MINUTE;
          blocks.push(
            work(f.startMs, first),
            { kind: 'break', startMs: pauseStart, endMs: pauseEnd, title: '', calendarId: e.calendarId },
            work(pauseEnd, chunk - first),
          );
        } else {
          blocks.push(work(f.startMs, chunk));
        }
        dayLeft -= chunk;
        left -= chunk;
      }
    }
    summary.set(e.id, { ...base, plannedMin: totalMin - left, missingMin: left, done: false });
  }

  const plan = { blocks, deadlines: summary };
  if (!bySettings) {
    bySettings = new WeakMap();
    workCache.set(data, bySettings);
  }
  bySettings.set(s, plan);
  return plan;
}

export interface Placement {
  taskId: string;
  /** One block, two when the task was split, none when nothing fits. */
  blocks: Block[];
}

/** How far ahead each quadrant may be placed. */
export const PLACEMENT_RULES = {
  /** Urgent (quadrants 1 and 3): within the next 3 days, split in 2 if needed. */
  urgentDays: 3,
  /** Important, not urgent: within 7 days of the day it was entered. */
  importantDays: 7,
  /** Neither: within 14 days of the day it was entered. */
  laterDays: 14,
} as const;

const STEP_MS = 5 * MINUTE;
/** Urgent first, then important, then the rest. */
const QUADRANT_ORDER: Record<TaskInput['quadrant'], number> = { 1: 0, 3: 1, 2: 2, 4: 3 };

/** Free time still available for tasks, consumed as tasks are placed. */
class FreeSlots {
  private slots: Interval[];
  constructor(slots: Interval[]) {
    this.slots = slots;
  }

  /** Length of the slot available before `limitMs`. */
  private room(slot: Interval, limitMs: number): number {
    return Math.min(slot.endMs, limitMs) - slot.startMs;
  }

  /** First slot (in time order) that fits `need` before `limitMs`, optionally on another day. */
  first(need: number, limitMs: number, accept: (slot: Interval) => boolean = () => true): Interval | null {
    return this.slots.find((x) => this.room(x, limitMs) >= need && accept(x)) ?? null;
  }

  /** Slot with the most room before `limitMs` (earliest on a tie), if it fits `need`. */
  largest(need: number, limitMs: number): Interval | null {
    let best: Interval | null = null;
    for (const x of this.slots) {
      if (this.room(x, limitMs) >= need && (!best || this.room(x, limitMs) > this.room(best, limitMs))) best = x;
    }
    return best;
  }

  /** Take `need` from the start of `slot`; returns the taken interval. */
  take(slot: Interval, need: number): Interval {
    const taken = { startMs: slot.startMs, endMs: slot.startMs + need };
    slot.startMs = Math.ceil((slot.startMs + need) / STEP_MS) * STEP_MS;
    return taken;
  }
}

/** End (exclusive) of the local day `days` after `date`. */
function endOfDay(date: string, days: number, tz: string): number {
  return zonedToUtc(addDays(date, days + 1), 0, tz);
}

/**
 * Tasks without a time are placed automatically, quadrant by quadrant
 * (urgent + important, urgent, important, neither), oldest first:
 * - urgent (1 and 3): the first free slot long enough within 3 days; if none,
 *   the task is split in 2 halves, put on 2 different days when possible;
 * - important, not urgent (2): the longest free slot within 7 days of the day
 *   it was entered;
 * - neither (4): the first free slot long enough within 14 days of the day it
 *   was entered.
 * A task whose deadline has passed gets the same span again from today.
 */
export function autoPlace(data: ScheduleData, s: ScheduleSettings, nowMs: number): Placement[] {
  const pending = data.tasks
    .filter((t) => !t.done && t.startMin === null)
    .sort((a, b) => QUADRANT_ORDER[a.quadrant] - QUADRANT_ORDER[b.quadrant] || a.createdAt.localeCompare(b.createdAt));
  if (pending.length === 0) return [];

  const today = localDate(nowMs, s.tz);
  const spanDays = (t: TaskInput) =>
    t.quadrant === 2 ? PLACEMENT_RULES.importantDays : t.quadrant === 4 ? PLACEMENT_RULES.laterDays : PLACEMENT_RULES.urgentDays;
  const limitOf = (t: TaskInput): number => {
    const days = spanDays(t);
    if (t.quadrant === 1 || t.quadrant === 3) return endOfDay(today, days - 1, s.tz);
    const entered = localDate(Date.parse(t.createdAt), s.tz);
    const limit = endOfDay(entered, days, s.tz);
    return limit > nowMs ? limit : endOfDay(today, days, s.tz);
  };

  const work = deadlineWork(data, s).blocks;
  const lastDay = Math.max(...pending.map((t) => Math.ceil((limitOf(t) - nowMs) / (DAY_MIN * MINUTE)) + 1));
  const intervals: Interval[] = [];
  for (let i = 0; i <= lastDay; i++) {
    for (const f of buildDay(addDays(today, i), data, s, nowMs, work).free) {
      const startMs = Math.ceil(Math.max(f.startMs, nowMs) / STEP_MS) * STEP_MS;
      if (f.endMs > startMs) intervals.push({ startMs, endMs: f.endMs });
    }
  }
  const free = new FreeSlots(intervals);
  const block = (t: TaskInput, i: Interval, part?: string): Block => ({
    kind: 'task',
    startMs: i.startMs,
    endMs: i.endMs,
    title: part ? `${t.title} (${part})` : t.title,
    taskId: t.id,
    autoPlaced: true,
  });

  return pending.map((t) => {
    const need = t.durationMin * MINUTE;
    const limit = limitOf(t);

    if (t.quadrant === 2) {
      const slot = free.largest(need, limit);
      return { taskId: t.id, blocks: slot ? [block(t, free.take(slot, need))] : [] };
    }
    const whole = free.first(need, limit);
    if (whole) return { taskId: t.id, blocks: [block(t, free.take(whole, need))] };
    if (t.quadrant === 4) return { taskId: t.id, blocks: [] };

    // Urgent and nothing long enough: two halves, on two different days if possible.
    const firstNeed = Math.ceil(t.durationMin / 2 / 5) * 5 * MINUTE;
    const secondNeed = need - firstNeed;
    if (secondNeed < MINUTE) return { taskId: t.id, blocks: [] };
    const a = free.first(firstNeed, limit);
    if (!a) return { taskId: t.id, blocks: [] };
    const aDay = localDate(a.startMs, s.tz);
    const afterA = (x: Interval) => x !== a && x.startMs >= a.startMs;
    const b =
      free.first(secondNeed, limit, (x) => afterA(x) && localDate(x.startMs, s.tz) !== aDay) ??
      free.first(secondNeed, limit, afterA);
    if (!b) return { taskId: t.id, blocks: [] };
    const first = free.take(a, firstNeed);
    const second = free.take(b, secondNeed);
    return { taskId: t.id, blocks: [block(t, first, '1/2'), block(t, second, '2/2')] };
  });
}

/** Day plan including auto-placed tasks. */
export function planDay(date: string, data: ScheduleData, s: ScheduleSettings, nowMs: number): { plan: DayPlan; placements: Placement[] } {
  const placements = autoPlace(data, s, nowMs);
  const extra = [...deadlineWork(data, s).blocks, ...placements.flatMap((p) => p.blocks)];
  return { plan: buildDay(date, data, s, nowMs, extra), placements };
}

/** Monday (ISO week start) of the week containing `date` (YYYY-MM-DD). */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export interface WeekPlan {
  start: string;
  days: DayPlan[];
  placements: Placement[];
  freeTotalMin: number;
  busyTotalMin: number;
  /** Longest free slot of the week, or null. */
  longestFree: Block | null;
}

/** Seven day plans (Monday to Sunday) sharing one auto-placement pass. */
export function planWeek(date: string, data: ScheduleData, s: ScheduleSettings, nowMs: number): WeekPlan {
  const start = weekStart(date);
  const placements = autoPlace(data, s, nowMs);
  const extra = [...deadlineWork(data, s).blocks, ...placements.flatMap((p) => p.blocks)];
  const days = Array.from({ length: 7 }, (_, i) => buildDay(addDays(start, i), data, s, nowMs, extra));
  let longestFree: Block | null = null;
  for (const d of days) {
    for (const f of d.free) {
      if (!longestFree || f.endMs - f.startMs > longestFree.endMs - longestFree.startMs) longestFree = f;
    }
  }
  return {
    start,
    days,
    placements,
    freeTotalMin: days.reduce((sum, d) => sum + d.freeTotalMin, 0),
    busyTotalMin: days.reduce((sum, d) => sum + d.busyTotalMin, 0),
    longestFree,
  };
}
