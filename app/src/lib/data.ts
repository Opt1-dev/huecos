// Data layer: loads the user's rows, keeps an offline copy in IndexedDB,
// listens to realtime changes and exposes engine-ready inputs.
import { computed, signal } from '@preact/signals';
import { openDB, type IDBPDatabase } from 'idb';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { session } from './session';
import { addDays, localDate, isValidTimeZone } from '../../../supabase/functions/_shared/tz.ts';
import type { BlockedKind, CalendarInfo, Role, ScheduleData, ScheduleSettings, TaskInput } from '../engine/schedule';

export interface SettingsRow {
  user_id: string;
  display_name: string | null;
  locale: 'fr' | 'es' | 'en';
  timezone: string;
  day_start_min: number;
  day_end_min: number;
  min_slot_min: number;
  module_etudes: boolean;
  module_outlook: boolean;
  module_practicas: boolean;
  practicas_start: string | null;
  practicas_end: string | null;
  practicas_weekdays: number[];
  practicas_start_min: number;
  practicas_end_min: number;
  practicas_total_hours: number;
  practicas_hour_factor: number;
  practicas_buffer_before_min: number;
  practicas_buffer_after_min: number;
  last_synced_at: string | null;
}

export interface CalendarRow {
  id: string;
  name: string;
  role: Role;
  color: string;
  buffer_before_min: number;
  buffer_after_min: number;
  counts_busy: boolean;
  sort_order: number;
  feed_host: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface EventRow {
  id: string;
  calendar_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  event_type: 'event' | 'focus' | 'deadline';
  status: 'confirmed' | 'tentative' | 'cancelled';
}

export interface OverrideRow {
  id: string;
  event_id: string;
  start_at: string | null;
  end_at: string | null;
  cancelled: boolean;
}

export interface TaskRow {
  id: string;
  title: string;
  quadrant: 1 | 2 | 3 | 4;
  day: string | null;
  start_min: number | null;
  duration_min: number;
  done: boolean;
  auto_placed: boolean;
  created_at: string;
}

export interface BlockedDayRow {
  date: string;
  kind: BlockedKind;
}

interface Snapshot {
  userId: string;
  savedAt: string;
  settings: SettingsRow | null;
  calendars: CalendarRow[];
  events: EventRow[];
  overrides: OverrideRow[];
  tasks: TaskRow[];
  blockedDays: BlockedDayRow[];
}

const CAL_COLUMNS =
  'id, name, role, color, buffer_before_min, buffer_after_min, counts_busy, sort_order, feed_host, last_synced_at, last_error';

export const settingsRow = signal<SettingsRow | null>(null);
export const calendars = signal<CalendarRow[]>([]);
export const events = signal<EventRow[]>([]);
export const overrides = signal<OverrideRow[]>([]);
export const tasks = signal<TaskRow[]>([]);
export const blockedDays = signal<BlockedDayRow[]>([]);
export const loaded = signal(false);
export const fromCache = signal(false);
export const syncing = signal(false);
export const lastError = signal<string | null>(null);
/** Dev-only sample data: no network reads or writes. */
export const demoMode = signal(false);

// ---------------------------------------------------------------------------
// Offline cache
// ---------------------------------------------------------------------------
let dbPromise: Promise<IDBPDatabase> | null = null;
function cacheDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB('huecos', 1, {
    upgrade(db) {
      db.createObjectStore('snapshot');
    },
  });
  return dbPromise;
}

async function saveSnapshot(userId: string): Promise<void> {
  const snap: Snapshot = {
    userId,
    savedAt: new Date().toISOString(),
    settings: settingsRow.value,
    calendars: calendars.value,
    events: events.value,
    overrides: overrides.value,
    tasks: tasks.value,
    blockedDays: blockedDays.value,
  };
  try {
    await (await cacheDb()).put('snapshot', snap, 'current');
  } catch {
    /* storage unavailable: online-only */
  }
}

async function loadSnapshot(userId: string): Promise<boolean> {
  try {
    const snap = (await (await cacheDb()).get('snapshot', 'current')) as Snapshot | undefined;
    if (!snap || snap.userId !== userId) return false;
    settingsRow.value = snap.settings;
    calendars.value = snap.calendars;
    events.value = snap.events;
    overrides.value = snap.overrides;
    tasks.value = snap.tasks;
    blockedDays.value = snap.blockedDays;
    return true;
  } catch {
    return false;
  }
}

export async function clearCache(): Promise<void> {
  try {
    await (await cacheDb()).delete('snapshot', 'current');
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
function eventRange(tz: string): { from: string; to: string } {
  const today = localDate(Date.now(), tz);
  return { from: `${addDays(today, -2)}T00:00:00Z`, to: `${addDays(today, 30)}T00:00:00Z` };
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

async function loadTable<T>(name: 'tasks' | 'overrides'): Promise<T[]> {
  const { data, error } = await supabase.from(name).select('*');
  fail(error);
  return (data ?? []) as T[];
}

export async function loadAll(): Promise<void> {
  const userId = session.value?.user.id;
  if (!userId || demoMode.value) return;
  if (!loaded.value && (await loadSnapshot(userId))) {
    fromCache.value = true;
    loaded.value = true;
  }
  try {
    const { data: s, error: se } = await supabase.from('settings').select('*').maybeSingle();
    fail(se);
    const tz = (s as SettingsRow | null)?.timezone ?? 'Europe/Madrid';
    const range = eventRange(tz);
    const [cals, evs, ovs, tks, bds] = await Promise.all([
      supabase.from('calendars').select(CAL_COLUMNS).order('sort_order').order('created_at'),
      supabase.from('events').select('id, calendar_id, title, start_at, end_at, all_day, event_type, status')
        .lt('start_at', range.to).gt('end_at', range.from).order('start_at').limit(5000),
      loadTable<OverrideRow>('overrides'),
      loadTable<TaskRow>('tasks'),
      supabase.from('blocked_days').select('date, kind').order('date'),
    ]);
    fail(cals.error);
    fail(evs.error);
    fail(bds.error);
    settingsRow.value = s as SettingsRow | null;
    calendars.value = (cals.data ?? []) as CalendarRow[];
    events.value = (evs.data ?? []) as EventRow[];
    overrides.value = ovs;
    tasks.value = tks;
    blockedDays.value = (bds.data ?? []) as BlockedDayRow[];
    fromCache.value = false;
    lastError.value = null;
    loaded.value = true;
    await saveSnapshot(userId);
  } catch (e) {
    lastError.value = e instanceof Error ? e.message : String(e);
    loaded.value = true;
  }
}

let channel: RealtimeChannel | null = null;
export function startRealtime(): void {
  const userId = session.value?.user.id;
  if (!userId || channel || demoMode.value) return;
  const refresh = async (table: 'tasks' | 'overrides') => {
    try {
      if (table === 'tasks') tasks.value = await loadTable<TaskRow>('tasks');
      else overrides.value = await loadTable<OverrideRow>('overrides');
      await saveSnapshot(userId);
    } catch {
      /* next full load will catch up */
    }
  };
  channel = supabase
    .channel(`user-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` }, () => void refresh('tasks'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'overrides', filter: `user_id=eq.${userId}` }, () => void refresh('overrides'))
    .subscribe();
}

export function stopRealtime(): void {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
}

// ---------------------------------------------------------------------------
// Engine inputs
// ---------------------------------------------------------------------------
export const scheduleSettings = computed<ScheduleSettings>(() => {
  const s = settingsRow.value;
  const tz = s && isValidTimeZone(s.timezone) ? s.timezone : 'Europe/Madrid';
  return {
    tz,
    dayStartMin: s?.day_start_min ?? 480,
    dayEndMin: s?.day_end_min ?? 1440,
    minSlotMin: s?.min_slot_min ?? 15,
    practicas: {
      enabled: s?.module_practicas ?? false,
      start: s?.practicas_start ?? null,
      end: s?.practicas_end ?? null,
      weekdays: s?.practicas_weekdays ?? [1, 2, 3, 4, 5],
      startMin: s?.practicas_start_min ?? 540,
      endMin: s?.practicas_end_min ?? 780,
      bufferBeforeMin: s?.practicas_buffer_before_min ?? 45,
      bufferAfterMin: s?.practicas_buffer_after_min ?? 75,
      totalHours: s?.practicas_total_hours ?? 500,
      hourFactor: Number(s?.practicas_hour_factor ?? 1),
    },
    blockedDays: new Map(blockedDays.value.map((b) => [b.date, b.kind])),
  };
});

export const scheduleData = computed<ScheduleData>(() => ({
  calendars: calendars.value.map<CalendarInfo>((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    color: c.color,
    bufferBeforeMin: c.buffer_before_min,
    bufferAfterMin: c.buffer_after_min,
    countsBusy: c.counts_busy,
  })),
  events: events.value.map((e) => ({
    id: e.id,
    calendarId: e.calendar_id,
    title: e.title,
    startMs: Date.parse(e.start_at),
    endMs: Date.parse(e.end_at),
    allDay: e.all_day,
    eventType: e.event_type,
    status: e.status,
  })),
  overrides: overrides.value.map((o) => ({
    eventId: o.event_id,
    startMs: o.start_at ? Date.parse(o.start_at) : null,
    endMs: o.end_at ? Date.parse(o.end_at) : null,
    cancelled: o.cancelled,
  })),
  tasks: tasks.value.map<TaskInput>((t) => ({
    id: t.id,
    title: t.title,
    quadrant: t.quadrant,
    day: t.day,
    startMin: t.start_min,
    durationMin: t.duration_min,
    done: t.done,
    createdAt: t.created_at,
  })),
}));

// ---------------------------------------------------------------------------
// Mutations (each one reloads the affected rows)
// ---------------------------------------------------------------------------
async function afterWrite(): Promise<void> {
  const userId = session.value?.user.id;
  if (userId) await saveSnapshot(userId);
}

export async function addTask(input: Pick<TaskRow, 'title' | 'quadrant' | 'day' | 'start_min' | 'duration_min'>): Promise<void> {
  const { data, error } = await supabase.from('tasks').insert(input).select('*').single();
  fail(error);
  tasks.value = [...tasks.value, data as TaskRow];
  await afterWrite();
}

export async function updateTask(id: string, patch: Partial<Omit<TaskRow, 'id' | 'created_at'>>): Promise<void> {
  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select('*').single();
  fail(error);
  tasks.value = tasks.value.map((t) => (t.id === id ? (data as TaskRow) : t));
  await afterWrite();
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  fail(error);
  tasks.value = tasks.value.filter((t) => t.id !== id);
  await afterWrite();
}

export async function setOverride(eventId: string, patch: { start_at: string | null; end_at: string | null; cancelled: boolean }): Promise<void> {
  const { data, error } = await supabase
    .from('overrides')
    .upsert({ event_id: eventId, ...patch }, { onConflict: 'event_id' })
    .select('*')
    .single();
  fail(error);
  overrides.value = [...overrides.value.filter((o) => o.event_id !== eventId), data as OverrideRow];
  await afterWrite();
}

export async function clearOverride(eventId: string): Promise<void> {
  const { error } = await supabase.from('overrides').delete().eq('event_id', eventId);
  fail(error);
  overrides.value = overrides.value.filter((o) => o.event_id !== eventId);
  await afterWrite();
}

export async function updateSettings(patch: Partial<Omit<SettingsRow, 'user_id'>>): Promise<void> {
  const userId = session.value?.user.id;
  if (!userId) return;
  const { data, error } = await supabase.from('settings').update(patch).eq('user_id', userId).select('*').single();
  fail(error);
  settingsRow.value = data as SettingsRow;
  await afterWrite();
}

export type CalendarInput = Pick<CalendarRow, 'name' | 'role' | 'color' | 'buffer_before_min' | 'buffer_after_min' | 'counts_busy'>;

export async function addCalendar(input: CalendarInput): Promise<CalendarRow> {
  const { data, error } = await supabase
    .from('calendars')
    .insert({ ...input, sort_order: calendars.value.length })
    .select(CAL_COLUMNS)
    .single();
  fail(error);
  calendars.value = [...calendars.value, data as CalendarRow];
  await afterWrite();
  return data as CalendarRow;
}

export async function updateCalendar(id: string, patch: Partial<CalendarInput>): Promise<void> {
  const { data, error } = await supabase.from('calendars').update(patch).eq('id', id).select(CAL_COLUMNS).single();
  fail(error);
  calendars.value = calendars.value.map((c) => (c.id === id ? (data as CalendarRow) : c));
  await afterWrite();
}

export async function deleteCalendar(id: string): Promise<void> {
  const { error } = await supabase.from('calendars').delete().eq('id', id);
  fail(error);
  calendars.value = calendars.value.filter((c) => c.id !== id);
  events.value = events.value.filter((e) => e.calendar_id !== id);
  await afterWrite();
}

/** Error codes from the Edge Functions, or a generic code. */
async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      /* not JSON */
    }
  }
  return 'network';
}

export async function saveFeed(calendarId: string, url: string): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('save-feed', { body: { calendar_id: calendarId, url } });
  if (error) return { error: await functionError(error) };
  const { data } = await supabase.from('calendars').select(CAL_COLUMNS).eq('id', calendarId).single();
  if (data) calendars.value = calendars.value.map((c) => (c.id === calendarId ? (data as CalendarRow) : c));
  return { error: null };
}

export async function syncNow(): Promise<{ error: string | null }> {
  syncing.value = true;
  try {
    const { error } = await supabase.functions.invoke('sync-calendars', { body: { scope: 'me' } });
    const code = error ? await functionError(error) : null;
    await loadAll();
    return { error: code === 'too_soon' ? null : code };
  } finally {
    syncing.value = false;
  }
}

export async function addBlockedDays(rows: BlockedDayRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('blocked_days').upsert(rows, { onConflict: 'user_id,date' });
  fail(error);
  const { data } = await supabase.from('blocked_days').select('date, kind').order('date');
  blockedDays.value = (data ?? []) as BlockedDayRow[];
  await afterWrite();
}

export async function deleteBlockedDay(date: string): Promise<void> {
  const { error } = await supabase.from('blocked_days').delete().eq('date', date);
  fail(error);
  blockedDays.value = blockedDays.value.filter((b) => b.date !== date);
  await afterWrite();
}
