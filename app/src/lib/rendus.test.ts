import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  gradeSeries,
  nextColorIndex,
  parseGrade,
  stripDeadlinePrefix,
  suggestSubject,
  upcomingRendus,
  type DeadlineEvent,
  type RenduLite,
  type SubjectLite,
} from './rendus';

const TZ = 'Europe/Madrid';
const TODAY = '2026-11-13';
const subjects: SubjectLite[] = [
  { id: 'dewes', name: 'DEWES', color_index: 0 },
  { id: 'daw', name: 'Despliegue AW', color_index: 1 },
  { id: 'ing', name: 'Inglés', color_index: 2 },
];
// 22:59 UTC is 23:59 in Madrid on the same day.
const dl = (id: string, cal: string, title: string, date: string): DeadlineEvent => ({
  id,
  calendar_id: cal,
  title,
  start_at: `${date}T22:59:00Z`,
});
const rendu = (id: string, extra: Partial<RenduLite> = {}): RenduLite => ({
  id,
  event_id: null,
  subject_id: null,
  title: id,
  due: '2026-11-20',
  state: 'todo',
  grade: null,
  note: '',
  ...extra,
});
const run = (deadlines: DeadlineEvent[], rendus: RenduLite[] = [], done: string[] = []) =>
  upcomingRendus({ deadlines, rendus, subjects, done: new Set(done), today: TODAY, tz: TZ });

describe('small helpers', () => {
  it('removes the "Vencimiento de" prefix', () => {
    expect(stripDeadlinePrefix('Vencimiento de Tarea UT4')).toBe('Tarea UT4');
    expect(stripDeadlinePrefix('  vencimiento   DE Prueba')).toBe('Prueba');
    expect(stripDeadlinePrefix('Entrega final')).toBe('Entrega final');
  });

  it('suggests the subject named in the title, ignoring case and accents', () => {
    expect(suggestSubject('Prueba Abierta DEWES UD02', subjects)).toBe('dewes');
    expect(suggestSubject('Tarea de ingles', subjects)).toBe('ing');
    expect(suggestSubject('Despliegue AW – práctica', subjects)).toBe('daw');
    expect(suggestSubject('Ciberseguridad', subjects)).toBeNull();
    // Whole words only.
    expect(suggestSubject('DEWESX', subjects)).toBeNull();
  });

  it('counts days, negative when late', () => {
    expect(daysBetween('2026-11-13', '2026-11-20')).toBe(7);
    expect(daysBetween('2026-11-13', '2026-11-10')).toBe(-3);
    expect(daysBetween('2027-03-27', '2027-03-29')).toBe(2);
  });

  it('reads grades typed with a comma or a dot', () => {
    expect(parseGrade('7,5')).toBe(7.5);
    expect(parseGrade(' 10 ')).toBe(10);
    expect(parseGrade('7.86')).toBe(7.86);
    expect(parseGrade('11')).toBeNull();
    expect(parseGrade('-1')).toBeNull();
    expect(parseGrade('abc')).toBeNull();
    expect(parseGrade('')).toBeNull();
  });

  it('picks the first unused colour', () => {
    expect(nextColorIndex(subjects)).toBe(3);
    expect(nextColorIndex([])).toBe(0);
  });
});

describe('upcomingRendus', () => {
  it('lists deadlines of the next 14 days, late ones too, prefix removed', () => {
    const rows = run([
      dl('e1', 'cesur', 'Vencimiento de Tarea DEWES', '2026-11-20'),
      dl('e2', 'cesur', 'Vencimiento de Lejana', '2026-12-10'),
      dl('e3', 'cesur', 'Vencimiento de Atrasada', '2026-11-10'),
    ]);
    expect(rows.map((r) => [r.title, r.due, r.daysLeft, r.suggestedSubjectId])).toEqual([
      ['Atrasada', '2026-11-10', -3, null],
      ['Tarea DEWES', '2026-11-20', 7, 'dewes'],
    ]);
  });

  it('merges the same deadline from two calendars and numbers repeats in one calendar', () => {
    const rows = run([
      dl('a1', 'cesur', 'Vencimiento de Prueba Abierta UD02', '2026-11-18'),
      dl('a2', 'cesur', 'Vencimiento de Prueba Abierta UD02', '2026-11-18'),
      dl('a3', 'cesur', 'Vencimiento de Prueba Abierta UD02', '2026-11-18'),
      dl('b1', 'deadlines', 'Prueba abierta UD02', '2026-11-18'),
    ]);
    expect(rows.map((r) => r.title)).toEqual([
      'Prueba Abierta UD02 (1/3)',
      'Prueba Abierta UD02 (2/3)',
      'Prueba Abierta UD02 (3/3)',
    ]);
  });

  it('hides deadlines whose rendu is past "todo" or that are marked done', () => {
    const rows = run(
      [dl('e1', 'c', 'Vencimiento de A', '2026-11-15'), dl('e2', 'c', 'Vencimiento de B', '2026-11-16'), dl('e3', 'c', 'Vencimiento de C', '2026-11-17')],
      [rendu('r1', { event_id: 'e1', title: 'A', state: 'submitted' }), rendu('r2', { event_id: 'e2', title: 'B (à faire)', note: 'lire' })],
      ['e3'],
    );
    expect(rows.map((r) => [r.title, r.rendu?.id ?? null])).toEqual([['B (à faire)', 'r2']]);
  });

  it('links to the twin that already has a rendu', () => {
    const rows = run([dl('x1', 'c1', 'Vencimiento de A', '2026-11-15'), dl('x2', 'c2', 'A', '2026-11-15')], [rendu('r', { event_id: 'x2', title: 'A' })]);
    expect(rows.map((r) => [r.eventId, r.rendu?.id])).toEqual([['x2', 'r']]);
  });

  it('adds rendus typed by hand that are still to do', () => {
    const rows = run([], [rendu('m1', { due: '2026-11-14' }), rendu('m2', { due: '2026-11-15', state: 'done' }), rendu('m3', { due: '2027-01-01' })]);
    expect(rows.map((r) => r.title)).toEqual(['m1']);
  });
});

describe('gradeSeries', () => {
  it('groups graded rendus by subject with their average', () => {
    const series = gradeSeries(
      [
        rendu('a', { subject_id: 'dewes', state: 'graded', grade: 10, due: '2026-10-06' }),
        rendu('b', { subject_id: 'dewes', state: 'graded', grade: 7.86, due: '2026-10-27' }),
        rendu('c', { subject_id: 'ing', state: 'graded', grade: 9.35, due: '2026-10-12' }),
        rendu('d', { subject_id: 'ing', state: 'submitted', grade: null }),
        rendu('e', { state: 'graded', grade: 5 }),
      ],
      subjects,
      'Sans matière',
    );
    expect(series.map((s) => [s.name, s.points.length, Math.round(s.average * 100) / 100])).toEqual([
      ['DEWES', 2, 8.93],
      ['Inglés', 1, 9.35],
      ['Sans matière', 1, 5],
    ]);
  });
});
