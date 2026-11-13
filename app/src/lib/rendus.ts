// Rendus logic: pure functions, no I/O (tested in rendus.test.ts).
import { addDays, localDate } from '../../../supabase/functions/_shared/tz.ts';

export type RenduState = 'todo' | 'done' | 'submitted' | 'graded';
export const RENDU_STATES: readonly RenduState[] = ['todo', 'done', 'submitted', 'graded'];
/** Subject colours: the 8 validated categorical slots (see styles: --series-N). */
export const SUBJECT_COLOR_COUNT = 8;

export interface SubjectLite {
  id: string;
  name: string;
  color_index: number;
}

export interface RenduLite {
  id: string;
  event_id: string | null;
  subject_id: string | null;
  title: string;
  due: string;
  state: RenduState;
  grade: number | null;
  note: string;
}

export interface DeadlineEvent {
  id: string;
  calendar_id: string;
  title: string;
  start_at: string;
}

/** "Vencimiento de Tarea UT4" → "Tarea UT4". */
export function stripDeadlinePrefix(title: string): string {
  const stripped = title.replace(/^\s*vencimiento\s+de\s+/i, '').trim();
  return stripped || title.trim();
}

/** Lower case, no accents, single spaces. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The subject whose name appears in the title (the longest one wins). */
export function suggestSubject(title: string, subjects: readonly SubjectLite[]): string | null {
  const t = ` ${fold(title).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  let best: SubjectLite | null = null;
  for (const s of subjects) {
    const name = fold(s.name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (name && t.includes(` ${name} `) && (!best || name.length > fold(best.name).length)) best = s;
  }
  return best?.id ?? null;
}

/** Whole days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y!, m! - 1, day!);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** "7,5", "7.5", "10" → number between 0 and 10 (2 decimals at most), else null. */
export function parseGrade(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 10 ? n : null;
}

/** First colour slot not used yet (cycles once all 8 are taken). */
export function nextColorIndex(subjects: readonly SubjectLite[]): number {
  const used = new Set(subjects.map((s) => s.color_index));
  for (let i = 0; i < SUBJECT_COLOR_COUNT; i++) if (!used.has(i)) return i;
  return subjects.length % SUBJECT_COLOR_COUNT;
}

export interface UpcomingRow {
  key: string;
  /** Event the rendu is (or will be) linked to; null for a rendu typed by hand. */
  eventId: string | null;
  title: string;
  due: string;
  daysLeft: number;
  rendu: RenduLite | null;
  suggestedSubjectId: string | null;
}

interface UpcomingInput {
  deadlines: readonly DeadlineEvent[];
  rendus: readonly RenduLite[];
  subjects: readonly SubjectLite[];
  /** Deadline event ids marked done. */
  done: ReadonlySet<string>;
  today: string;
  tz: string;
  horizonDays?: number;
}

/**
 * Work still to do: deadlines up to `horizonDays` ahead (late ones too) and
 * rendus typed by hand, while their rendu is missing or still "todo".
 * The same deadline in several calendars shows once; identical deadlines in
 * one calendar are numbered (1/3), (2/3)…
 */
export function upcomingRendus(input: UpcomingInput): UpcomingRow[] {
  const { deadlines, rendus, subjects, done, today, tz } = input;
  const last = addDays(today, input.horizonDays ?? 14);
  const byEvent = new Map(rendus.filter((r) => r.event_id).map((r) => [r.event_id!, r]));

  // Group by (title, due date), then by calendar.
  const groups = new Map<string, { title: string; due: string; byCal: Map<string, DeadlineEvent[]> }>();
  for (const e of deadlines) {
    const due = localDate(Date.parse(e.start_at), tz);
    if (due > last) continue;
    const title = stripDeadlinePrefix(e.title);
    const key = `${due}|${fold(title)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { title, due, byCal: new Map() }));
    const list = g.byCal.get(e.calendar_id) ?? [];
    list.push(e);
    g.byCal.set(e.calendar_id, list);
  }

  const rows: UpcomingRow[] = [];
  for (const [key, g] of groups) {
    const perCal = [...g.byCal.values()].map((l) => [...l].sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id)));
    const n = Math.max(...perCal.map((l) => l.length));
    for (let i = 0; i < n; i++) {
      // The same deadline in other calendars: one row, linked to the event that has a rendu if any.
      const twins = perCal.map((l) => l[i]).filter((e): e is DeadlineEvent => Boolean(e));
      const linked = twins.find((e) => byEvent.has(e.id)) ?? twins[0]!;
      const rendu = byEvent.get(linked.id) ?? null;
      if (rendu ? rendu.state !== 'todo' : twins.some((e) => done.has(e.id))) continue;
      const title = n > 1 ? `${g.title} (${i + 1}/${n})` : g.title;
      rows.push({
        key: `${key}|${i}`,
        eventId: linked.id,
        title: rendu?.title ?? title,
        due: g.due,
        daysLeft: daysBetween(today, g.due),
        rendu,
        suggestedSubjectId: suggestSubject(g.title, subjects),
      });
    }
  }

  for (const r of rendus) {
    if (r.event_id || r.state !== 'todo' || r.due > last) continue;
    rows.push({
      key: `manual|${r.id}`,
      eventId: null,
      title: r.title,
      due: r.due,
      daysLeft: daysBetween(today, r.due),
      rendu: r,
      suggestedSubjectId: null,
    });
  }
  return rows.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

export interface SubjectSeries {
  subjectId: string | null;
  name: string;
  colorIndex: number;
  average: number;
  points: { due: string; grade: number; title: string }[];
}

/** Graded rendus per subject, oldest first, with each subject's average. */
export function gradeSeries(rendus: readonly RenduLite[], subjects: readonly SubjectLite[], noSubject: string): SubjectSeries[] {
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const series = new Map<string, SubjectSeries>();
  for (const r of rendus) {
    if (r.state !== 'graded' || r.grade === null) continue;
    const s = r.subject_id ? subjectById.get(r.subject_id) : undefined;
    const key = s?.id ?? '';
    let entry = series.get(key);
    if (!entry) {
      entry = { subjectId: s?.id ?? null, name: s?.name ?? noSubject, colorIndex: s?.color_index ?? 0, average: 0, points: [] };
      series.set(key, entry);
    }
    entry.points.push({ due: r.due, grade: Number(r.grade), title: r.title });
  }
  for (const s of series.values()) {
    s.points.sort((a, b) => a.due.localeCompare(b.due));
    s.average = s.points.reduce((sum, p) => sum + p.grade, 0) / s.points.length;
  }
  return [...series.values()].sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));
}
