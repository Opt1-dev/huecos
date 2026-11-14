// Data layer: loads the user's rows, keeps an offline copy in IndexedDB,
// listens to realtime changes and exposes engine-ready inputs.
import { computed, signal } from '@preact/signals';
import { openDB, type IDBPDatabase } from 'idb';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { session } from './session';
import { addDays, localDate, isValidTimeZone } from '../../../supabase/functions/_shared/tz.ts';
import type { TitleRow } from './repeats';
import type { RenduLite, RenduState, SubjectLite } from './rendus';
import type { NoteLite } from './notes';
import type { BlockedKind, CalendarInfo, EntryInput, Role, ScheduleData, ScheduleSettings, TaskInput } from '../engine/schedule';

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
  /** feed = synced from an .ics link; manual = entries typed in Huecos. */
  source: 'feed' | 'manual';
  /** Event titles hidden in Huecos (days off, holidays…). */
  hidden_titles: string[];
  /** Work needed before each deadline of this calendar (0 = none). */
  deadline_work_min: number;
  deadline_daily_max_min: number;
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

/** Entry of a manual calendar, repeated on some weekdays between two dates. */
export interface EntryRow {
  id: string;
  calendar_id: string;
  title: string;
  start_min: number;
  end_min: number;
  weekdays: number[];
  start_date: string;
  end_date: string | null;
}

export type SubjectRow = SubjectLite;
export type RenduRow = RenduLite & { created_at: string; updated_at: string };
export type NoteRow = NoteLite & { created_at: string };

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
  /** Missing in snapshots saved before manual calendars existed. */
  entries?: EntryRow[];
  /** Missing in snapshots saved before deadline work existed. */
  doneDeadlines?: string[];
  /** Missing in snapshots saved before rendus existed. */
  subjects?: SubjectRow[];
  rendus?: RenduRow[];
  /** Missing in snapshots saved before notes existed. */
  notes?: NoteRow[];
  overrides: OverrideRow[];
  tasks: TaskRow[];
  blockedDays: BlockedDayRow[];
}

const CAL_COLUMNS =
  'id, name, role, color, buffer_before_min, buffer_after_min, counts_busy, sort_order, source, hidden_titles, deadline_work_min, deadline_daily_max_min, feed_host, last_synced_at, last_error';
const ENTRY_COLUMNS = 'id, calendar_id, title, start_min, end_min, weekdays, start_date, end_date';
const SUBJECT_COLUMNS = 'id, name, color_index';
const RENDU_COLUMNS = 'id, event_id, subject_id, title, due, state, grade, note, created_at, updated_at';
const NOTE_COLUMNS = 'id, subject_id, title, body, pinned, created_at, updated_at';

/** Postgres numeric comes back as text. */
function normalizeRendus(rows: RenduRow[]): RenduRow[] {
  return rows.map((r) => ({ ...r, grade: r.grade === null ? null : Number(r.grade) }));
}

export const settingsRow = signal<SettingsRow | null>(null);
export const calendars = signal<CalendarRow[]>([]);
export const events = signal<EventRow[]>([]);
export const entries = signal<EntryRow[]>([]);
/** Ids of deadline events marked done. */
export const doneDeadlines = signal<string[]>([]);
export const subjects = signal<SubjectRow[]>([]);
export const rendus = signal<RenduRow[]>([]);
export const notes = signal<NoteRow[]>([]);
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
    entries: entries.value,
    doneDeadlines: doneDeadlines.value,
    subjects: subjects.value,
    rendus: rendus.value,
    notes: notes.value,
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
    entries.value = snap.entries ?? [];
    doneDeadlines.value = snap.doneDeadlines ?? [];
    subjects.value = snap.subjects ?? [];
    rendus.value = snap.rendus ?? [];
    notes.value = snap.notes ?? [];
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

async function loadSubjects(): Promise<SubjectRow[]> {
  const { data, error } = await supabase.from('subjects').select(SUBJECT_COLUMNS).order('created_at');
  fail(error);
  return (data ?? []) as SubjectRow[];
}

async function loadNotes(): Promise<NoteRow[]> {
  const { data, error } = await supabase.from('notes').select(NOTE_COLUMNS).order('updated_at', { ascending: false });
  fail(error);
  return (data ?? []) as NoteRow[];
}

async function loadRendus(): Promise<RenduRow[]> {
  const { data, error } = await supabase.from('rendus').select(RENDU_COLUMNS).order('due');
  fail(error);
  return normalizeRendus((data ?? []) as RenduRow[]);
}

async function loadDoneDeadlines(): Promise<string[]> {
  const { data, error } = await supabase.from('deadline_done').select('event_id');
  fail(error);
  return ((data ?? []) as { event_id: string }[]).map((r) => r.event_id);
}

async function loadEntries(): Promise<EntryRow[]> {
  const { data, error } = await supabase.from('calendar_entries').select(ENTRY_COLUMNS).order('start_min');
  fail(error);
  return (data ?? []) as EntryRow[];
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
    const [cals, evs, ens, dds, sbs, rds, nts, ovs, tks, bds] = await Promise.all([
      supabase.from('calendars').select(CAL_COLUMNS).order('sort_order').order('created_at'),
      supabase.from('events').select('id, calendar_id, title, start_at, end_at, all_day, event_type, status')
        .lt('start_at', range.to).gt('end_at', range.from).order('start_at').limit(5000),
      supabase.from('calendar_entries').select(ENTRY_COLUMNS).order('start_min'),
      supabase.from('deadline_done').select('event_id'),
      supabase.from('subjects').select(SUBJECT_COLUMNS).order('created_at'),
      supabase.from('rendus').select(RENDU_COLUMNS).order('due'),
      supabase.from('notes').select(NOTE_COLUMNS).order('updated_at', { ascending: false }),
      loadTable<OverrideRow>('overrides'),
      loadTable<TaskRow>('tasks'),
      supabase.from('blocked_days').select('date, kind').order('date'),
    ]);
    fail(cals.error);
    fail(evs.error);
    fail(ens.error);
    fail(dds.error);
    fail(sbs.error);
    fail(rds.error);
    fail(nts.error);
    fail(bds.error);
    settingsRow.value = s as SettingsRow | null;
    calendars.value = (cals.data ?? []) as CalendarRow[];
    events.value = (evs.data ?? []) as EventRow[];
    entries.value = (ens.data ?? []) as EntryRow[];
    doneDeadlines.value = ((dds.data ?? []) as { event_id: string }[]).map((r) => r.event_id);
    subjects.value = (sbs.data ?? []) as SubjectRow[];
    rendus.value = normalizeRendus((rds.data ?? []) as RenduRow[]);
    notes.value = (nts.data ?? []) as NoteRow[];
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
  const refresh = async (table: 'tasks' | 'overrides' | 'calendar_entries' | 'deadline_done' | 'subjects' | 'rendus' | 'notes') => {
    try {
      if (table === 'tasks') tasks.value = await loadTable<TaskRow>('tasks');
      else if (table === 'overrides') overrides.value = await loadTable<OverrideRow>('overrides');
      else if (table === 'calendar_entries') entries.value = await loadEntries();
      else if (table === 'deadline_done') doneDeadlines.value = await loadDoneDeadlines();
      else if (table === 'subjects') subjects.value = await loadSubjects();
      else if (table === 'rendus') rendus.value = await loadRendus();
      else notes.value = await loadNotes();
      await saveSnapshot(userId);
    } catch {
      /* next full load will catch up */
    }
  };
  channel = supabase
    .channel(`user-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` }, () => void refresh('tasks'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'overrides', filter: `user_id=eq.${userId}` }, () => void refresh('overrides'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_entries', filter: `user_id=eq.${userId}` }, () =>
      void refresh('calendar_entries'),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deadline_done', filter: `user_id=eq.${userId}` }, () =>
      void refresh('deadline_done'),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subjects', filter: `user_id=eq.${userId}` }, () => void refresh('subjects'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rendus', filter: `user_id=eq.${userId}` }, () => void refresh('rendus'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${userId}` }, () => void refresh('notes'))
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
    // Older offline snapshots have no hidden_titles.
    hiddenTitles: c.hidden_titles ?? [],
    deadlineWorkMin: c.deadline_work_min ?? 0,
    deadlineDailyMaxMin: c.deadline_daily_max_min ?? 120,
  })),
  doneDeadlines: doneDeadlines.value,
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
  entries: entries.value.map<EntryInput>((e) => ({
    id: e.id,
    calendarId: e.calendar_id,
    title: e.title,
    startMin: e.start_min,
    endMin: e.end_min,
    weekdays: e.weekdays,
    startDate: e.start_date,
    endDate: e.end_date,
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

export async function addCalendar(input: CalendarInput & { source: CalendarRow['source'] }): Promise<CalendarRow> {
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

export type CalendarPatch = Partial<CalendarInput & Pick<CalendarRow, 'deadline_work_min' | 'deadline_daily_max_min'>>;

export async function updateCalendar(id: string, patch: CalendarPatch): Promise<void> {
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
  entries.value = entries.value.filter((e) => e.calendar_id !== id);
  await afterWrite();
}

export async function setHiddenTitles(id: string, titles: string[]): Promise<void> {
  const { data, error } = await supabase.from('calendars').update({ hidden_titles: titles }).eq('id', id).select(CAL_COLUMNS).single();
  fail(error);
  calendars.value = calendars.value.map((c) => (c.id === id ? (data as CalendarRow) : c));
  await afterWrite();
}

/** Titles and times of every synced event of a calendar (to find repeated titles). */
export async function calendarTitles(calendarId: string): Promise<TitleRow[]> {
  if (demoMode.value) return events.value.filter((e) => e.calendar_id === calendarId);
  const { data, error } = await supabase
    .from('events')
    .select('title, all_day, start_at, end_at')
    .eq('calendar_id', calendarId)
    .limit(5000);
  fail(error);
  return (data ?? []) as TitleRow[];
}

/** Mark a deadline done (its remaining work is no longer placed) or not done. */
export async function setDeadlineDone(eventId: string, done: boolean): Promise<void> {
  if (demoMode.value) {
    doneDeadlines.value = done ? [...doneDeadlines.value, eventId] : doneDeadlines.value.filter((id) => id !== eventId);
    return;
  }
  const { error } = done
    ? await supabase.from('deadline_done').upsert({ event_id: eventId }, { onConflict: 'event_id', ignoreDuplicates: true })
    : await supabase.from('deadline_done').delete().eq('event_id', eventId);
  fail(error);
  doneDeadlines.value = done
    ? [...new Set([...doneDeadlines.value, eventId])]
    : doneDeadlines.value.filter((id) => id !== eventId);
  rendus.value = await loadRendus();
  await afterWrite();
}

// ---------------------------------------------------------------------------
// Subjects and rendus
// ---------------------------------------------------------------------------
export async function addSubject(name: string, colorIndex: number): Promise<void> {
  const { data, error } = await supabase
    .from('subjects')
    .insert({ name: name.trim(), color_index: colorIndex })
    .select(SUBJECT_COLUMNS)
    .single();
  fail(error);
  subjects.value = [...subjects.value, data as SubjectRow];
  await afterWrite();
}

export async function updateSubject(id: string, patch: Partial<Pick<SubjectRow, 'name' | 'color_index'>>): Promise<void> {
  const { data, error } = await supabase.from('subjects').update(patch).eq('id', id).select(SUBJECT_COLUMNS).single();
  fail(error);
  subjects.value = subjects.value.map((x) => (x.id === id ? (data as SubjectRow) : x));
  await afterWrite();
}

export async function deleteSubject(id: string): Promise<void> {
  const { error } = await supabase.from('subjects').delete().eq('id', id);
  fail(error);
  subjects.value = subjects.value.filter((x) => x.id !== id);
  notes.value = notes.value.map((n) => (n.subject_id === id ? { ...n, subject_id: null } : n));
  await afterWrite();
}

export type RenduFields = Partial<Pick<RenduRow, 'subject_id' | 'title' | 'due' | 'state' | 'grade' | 'note'>>;

/** Rendus and done deadlines follow each other on the server: reload both. */
async function afterRenduWrite(): Promise<void> {
  const [r, d] = await Promise.all([loadRendus(), loadDoneDeadlines()]);
  rendus.value = r;
  doneDeadlines.value = d;
  await afterWrite();
}

export async function addRendu(fields: RenduFields & Pick<RenduRow, 'title' | 'due'> & { event_id?: string | null }): Promise<void> {
  const { error } = await supabase.from('rendus').insert(fields);
  fail(error);
  await afterRenduWrite();
}

export async function updateRendu(id: string, patch: RenduFields): Promise<void> {
  const { error } = await supabase.from('rendus').update(patch).eq('id', id);
  fail(error);
  await afterRenduWrite();
}

export async function deleteRendu(id: string): Promise<void> {
  const { error } = await supabase.from('rendus').delete().eq('id', id);
  fail(error);
  await afterRenduWrite();
}

export type { RenduState };

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
export type NoteFields = Partial<Pick<NoteRow, 'subject_id' | 'title' | 'body' | 'pinned'>>;

export async function addNote(fields: NoteFields & Pick<NoteRow, 'title'>): Promise<void> {
  const { data, error } = await supabase.from('notes').insert(fields).select(NOTE_COLUMNS).single();
  fail(error);
  notes.value = [data as NoteRow, ...notes.value];
  await afterWrite();
}

export async function updateNote(id: string, patch: NoteFields): Promise<void> {
  const { data, error } = await supabase.from('notes').update(patch).eq('id', id).select(NOTE_COLUMNS).single();
  fail(error);
  notes.value = notes.value.map((n) => (n.id === id ? (data as NoteRow) : n));
  await afterWrite();
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', id);
  fail(error);
  notes.value = notes.value.filter((n) => n.id !== id);
  await afterWrite();
}

export type EntryFields = Omit<EntryRow, 'id' | 'calendar_id'>;

function sortEntries(list: EntryRow[]): EntryRow[] {
  return [...list].sort((a, b) => a.start_min - b.start_min || a.title.localeCompare(b.title));
}

export async function addEntry(calendarId: string, input: EntryFields): Promise<void> {
  const { data, error } = await supabase
    .from('calendar_entries')
    .insert({ calendar_id: calendarId, ...input })
    .select(ENTRY_COLUMNS)
    .single();
  fail(error);
  entries.value = sortEntries([...entries.value, data as EntryRow]);
  await afterWrite();
}

export async function updateEntry(id: string, patch: EntryFields): Promise<void> {
  const { data, error } = await supabase.from('calendar_entries').update(patch).eq('id', id).select(ENTRY_COLUMNS).single();
  fail(error);
  entries.value = sortEntries(entries.value.map((e) => (e.id === id ? (data as EntryRow) : e)));
  await afterWrite();
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from('calendar_entries').delete().eq('id', id);
  fail(error);
  entries.value = entries.value.filter((e) => e.id !== id);
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
