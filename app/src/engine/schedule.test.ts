import { describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc } from '../../../supabase/functions/_shared/tz.ts';
import {
  autoPlace,
  buildDay,
  deadlineWork,
  entryOccurs,
  mergeIntervals,
  planDay,
  planWeek,
  weekStart,
  practicasHours,
  type CalendarInfo,
  type EntryInput,
  type EventInput,
  type ScheduleData,
  type ScheduleSettings,
  type TaskInput,
} from './schedule';

const TZ = 'Europe/Madrid';
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedToUtc(date, h! * 60 + m!, TZ);
};
const hm = (ms: number) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const slots = (plan: { free: { startMs: number; endMs: number }[] }) => plan.free.map((f) => `${hm(f.startMs)}-${hm(f.endMs)}`);

const settings = (over: Partial<ScheduleSettings> = {}): ScheduleSettings => ({
  tz: TZ,
  dayStartMin: 480,
  dayEndMin: 1440,
  minSlotMin: 15,
  practicas: {
    enabled: false,
    start: '2026-10-01',
    end: '2027-03-01',
    weekdays: [1, 2, 3, 4, 5],
    startMin: 540,
    endMin: 780,
    bufferBeforeMin: 45,
    bufferAfterMin: 75,
    totalHours: 500,
    hourFactor: 1,
  },
  blockedDays: new Map(),
  ...over,
});
const withPracticas = (blocked: [string, 'non_school' | 'holiday'][] = []) => {
  const s = settings({ blockedDays: new Map(blocked) });
  s.practicas.enabled = true;
  return s;
};

const cal = (id: string, role: CalendarInfo['role'], before = 0, after = 0, countsBusy = true): CalendarInfo => ({
  id,
  name: id,
  role,
  color: '#123456',
  bufferBeforeMin: before,
  bufferAfterMin: after,
  countsBusy,
});
const CALS = [cal('amorino', 'work', 75, 0), cal('gym', 'gym', 30, 30), cal('other', 'other'), cal('cesur', 'school')];

let n = 0;
const ev = (calendarId: string, start: number, end: number, extra: Partial<EventInput> = {}): EventInput => ({
  id: `e${++n}`,
  calendarId,
  title: calendarId,
  startMs: start,
  endMs: end,
  allDay: false,
  eventType: 'event',
  status: 'confirmed',
  ...extra,
});
const data = (events: EventInput[] = [], tasks: TaskInput[] = [], overrides: ScheduleData['overrides'] = []): ScheduleData => ({
  calendars: CALS,
  events,
  overrides,
  tasks,
});
const task = (id: string, extra: Partial<TaskInput> = {}): TaskInput => ({
  id,
  title: id,
  quadrant: 1,
  day: null,
  startMin: null,
  durationMin: 60,
  done: false,
  createdAt: `2026-11-01T00:00:0${id.length}Z`,
  ...extra,
});

const D = '2026-11-18'; // Wednesday
const MORNING = at(D, '07:00');

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        { startMs: 10, endMs: 20 },
        { startMs: 0, endMs: 5 },
        { startMs: 15, endMs: 30 },
        { startMs: 30, endMs: 35 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 5 },
      { startMs: 10, endMs: 35 },
    ]);
  });
});

describe('buildDay', () => {
  it('empty day: one 16 h slot from 08:00 to 00:00', () => {
    const p = buildDay(D, data(), settings(), MORNING);
    expect(slots(p)).toEqual(['08:00-00:00']);
    expect(p.freeTotalMin).toBe(960);
    expect(p.longestFreeMin).toBe(960);
    expect(p.busyTotalMin).toBe(0);
    expect(p.nextFree && hm(p.nextFree.startMs)).toBe('08:00');
  });

  it('overlapping blocks are merged before computing free time', () => {
    const p = buildDay(
      D,
      data([ev('other', at(D, '10:00'), at(D, '12:00')), ev('other', at(D, '11:00'), at(D, '13:00'))]),
      settings(),
      MORNING,
    );
    expect(slots(p)).toEqual(['08:00-10:00', '13:00-00:00']);
    expect(p.busyTotalMin).toBe(180);
  });

  it('a shift ending after midnight is shown but time after 00:00 is never free', () => {
    const p = buildDay(D, data([ev('amorino', at(D, '18:00'), at('2026-11-19', '01:00'))]), settings(), MORNING);
    // 1 h 15 buffer before the shift: 16:45-18:00.
    expect(slots(p)).toEqual(['08:00-16:45']);
    expect(p.busyTotalMin).toBe(75 + 360);
    expect(p.busy.some((b) => b.endMs === at('2026-11-19', '01:00'))).toBe(true);
    expect(p.displayEndMs).toBe(at('2026-11-19', '02:00'));
  });

  it('colliding buffers merge and free time never overlaps a buffer', () => {
    // Gym 15:00-17:00 (+30 after = 17:30), Amorino at 18:30 (-1h15 = 17:15).
    const p = buildDay(
      D,
      data([ev('gym', at(D, '15:00'), at(D, '17:00')), ev('amorino', at(D, '18:30'), at(D, '22:00'))]),
      settings(),
      MORNING,
    );
    expect(slots(p)).toEqual(['08:00-14:30', '22:00-00:00']);
    for (const f of p.free) for (const b of p.buffers) expect(f.endMs <= b.startMs || f.startMs >= b.endMs).toBe(true);
    expect(p.buffers.map((b) => `${hm(b.startMs)}-${hm(b.endMs)}`)).toEqual(['14:30-15:00', '17:00-18:30']);
  });

  it('ignores free slots under 15 minutes', () => {
    const p = buildDay(
      D,
      data([ev('other', at(D, '08:10'), at(D, '10:00')), ev('other', at(D, '10:14'), at(D, '23:50'))]),
      settings(),
      MORNING,
    );
    expect(slots(p)).toEqual([]);
    expect(p.freeTotalMin).toBe(0);
  });

  it('DST change on 28 Mar 2027 keeps a 16 h window in local time', () => {
    const date = '2027-03-28';
    const p = buildDay(date, data(), settings(), zonedToUtc(date, 0, TZ));
    expect(new Date(p.windowStartMs).toISOString()).toBe('2027-03-28T06:00:00.000Z');
    expect(p.freeTotalMin).toBe(960);
    const before = buildDay('2027-03-27', data(), settings(), zonedToUtc('2027-03-27', 0, TZ));
    expect(new Date(before.windowStartMs).toISOString()).toBe('2027-03-27T07:00:00.000Z');
    // 27 Mar display runs to 02:00 on the 28th, which is still CET.
    expect(new Date(before.displayEndMs).toISOString()).toBe('2027-03-28T01:00:00.000Z');
  });

  it('generates prácticas 09:00-13:00 with 45 min before and 1 h 15 after', () => {
    const p = buildDay(D, data(), withPracticas(), MORNING);
    expect(p.busy.map((b) => b.kind)).toEqual(['practicas']);
    // 08:00-08:15 is exactly 15 min, so it is kept (only slots under 15 min are dropped).
    expect(slots(p)).toEqual(['08:00-08:15', '14:15-00:00']);
    expect(p.buffers.map((b) => `${hm(b.startMs)}-${hm(b.endMs)}`)).toEqual(['08:15-09:00', '13:00-14:15']);
  });

  it('a blocked day has no prácticas', () => {
    const p = buildDay(D, data(), withPracticas([[D, 'holiday']]), MORNING);
    expect(p.busy).toEqual([]);
    expect(p.practicasBlocked).toBe('holiday');
    expect(p.freeTotalMin).toBe(960);
  });

  it('weekends and dates outside the period have no prácticas', () => {
    expect(buildDay('2026-11-21', data(), withPracticas(), MORNING).busy).toEqual([]);
    expect(buildDay('2027-03-02', data(), withPracticas(), MORNING).busy).toEqual([]);
  });

  it('all-day events, deadlines and cancelled events do not block', () => {
    const p = buildDay(
      D,
      data([
        ev('cesur', at(D, '00:00'), at('2026-11-19', '00:00'), { allDay: true }),
        ev('cesur', at(D, '23:59'), at(D, '23:59'), { eventType: 'deadline', title: 'Vencimiento de UT3' }),
        ev('other', at(D, '10:00'), at(D, '11:00'), { status: 'cancelled' }),
      ]),
      settings(),
      MORNING,
    );
    expect(p.freeTotalMin).toBe(960);
    expect(p.notes).toHaveLength(2);
  });

  it('overrides move or cancel an event', () => {
    const moved = ev('other', at(D, '10:00'), at(D, '11:00'));
    const gone = ev('other', at(D, '15:00'), at(D, '16:00'));
    const p = buildDay(
      D,
      data([moved, gone], [], [
        { eventId: moved.id, startMs: at(D, '12:00'), endMs: at(D, '13:00'), cancelled: false },
        { eventId: gone.id, startMs: null, endMs: null, cancelled: true },
      ]),
      settings(),
      MORNING,
    );
    expect(slots(p)).toEqual(['08:00-12:00', '13:00-00:00']);
    expect(p.busy[0]!.moved).toBe(true);
    expect(p.cancelled.map((c) => c.eventId)).toEqual([gone.id]);
  });

  it('timed tasks occupy the day', () => {
    const p = buildDay(D, data([], [task('t', { day: D, startMin: 600, durationMin: 90 })]), settings(), MORNING);
    expect(slots(p)).toEqual(['08:00-10:00', '11:30-00:00']);
  });
});

describe('auto-placement', () => {
  const now = at(D, '08:00');
  const day = (i: number) => addDays(D, i);
  /** Busy from 08:00 to `until` on day offsets [from, to], except `free` offsets. */
  const busyDays = (from: number, to: number, until: string, free: number[] = []) =>
    Array.from({ length: to - from + 1 }, (_, k) => from + k)
      .filter((i) => !free.includes(i))
      .map((i) => ev('other', at(day(i), '08:00'), at(day(i), until)));
  const where = (b: { startMs: number }) => `${localDate(b.startMs, TZ)} ${hm(b.startMs)}`;

  it('puts an urgent+important task in the first slot long enough', () => {
    const d = data([ev('other', at(D, '08:30'), at(D, '20:00'))], [task('a', { durationMin: 120 })]);
    const [placement] = autoPlace(d, settings(), now);
    expect(placement!.blocks.map(where)).toEqual([`${D} 20:00`]);
    const { plan } = planDay(D, d, settings(), now);
    expect(plan.busy.some((b) => b.autoPlaced)).toBe(true);
    expect(slots(plan)).toEqual(['08:00-08:30', '22:00-00:00']);
  });

  it('ignores done tasks and tasks with a time', () => {
    const d = data([], [task('c', { done: true }), task('dd', { day: D, startMin: 600 })]);
    expect(autoPlace(d, settings(), now)).toEqual([]);
  });

  it('splits an urgent task in 2 halves on 2 different days when no slot is long enough', () => {
    // Every day only 23:00–00:00 is free.
    const d = data(busyDays(0, 3, '23:00'), [task('a', { durationMin: 90 })]);
    const [placement] = autoPlace(d, settings(), now);
    expect(placement!.blocks.map(where)).toEqual([`${D} 23:00`, `${day(1)} 23:00`]);
    expect(placement!.blocks.map((b) => (b.endMs - b.startMs) / 60_000)).toEqual([45, 45]);
    expect(placement!.blocks.map((b) => b.title)).toEqual(['a (1/2)', 'a (2/2)']);
  });

  it('keeps urgent tasks within 3 days', () => {
    // Nothing free for 3 days; the 4th day is free but too late.
    const d = data(busyDays(0, 2, '23:55'), [task('a', { durationMin: 30 }), task('bb', { quadrant: 3, durationMin: 30 })]);
    expect(autoPlace(d, settings(), now).map((p) => p.blocks)).toEqual([[], []]);
    const d2 = data(busyDays(0, 1, '23:55'), [task('a', { durationMin: 30 })]);
    expect(autoPlace(d2, settings(), now)[0]!.blocks.map(where)).toEqual([`${day(2)} 08:00`]);
  });

  it('places urgent tasks first, then important, then the rest', () => {
    const d = data(
      [],
      [
        task('q4', { quadrant: 4, createdAt: '2026-11-17T00:00:00Z' }),
        task('q3', { quadrant: 3, createdAt: '2026-11-17T00:00:01Z' }),
        task('q1', { quadrant: 1, createdAt: '2026-11-17T00:00:02Z' }),
      ],
    );
    const out = autoPlace(d, settings(), now);
    expect(out.map((p) => `${p.taskId} ${hm(p.blocks[0]!.startMs)}`)).toEqual(['q1 08:00', 'q3 09:00', 'q4 10:00']);
  });

  it('puts an important, not urgent task in the longest free slot of the next 7 days', () => {
    // Free evenings everywhere; Sunday (day 4) completely free; day 9 too, but too late.
    const d = data(busyDays(0, 12, '20:00', [4, 9]), [task('imp', { quadrant: 2, createdAt: `${D}T07:00:00Z` })]);
    expect(autoPlace(d, settings(), now)[0]!.blocks.map(where)).toEqual([`${day(4)} 08:00`]);
  });

  it('counts the 7 days from the day the task was entered', () => {
    // Entered 5 days ago: the free Sunday (day 4) is after its deadline (day 2).
    const d = data(busyDays(0, 12, '20:00', [4]), [task('imp', { quadrant: 2, createdAt: '2026-11-13T09:00:00Z' })]);
    expect(autoPlace(d, settings(), now)[0]!.blocks.map(where)).toEqual([`${D} 20:00`]);
  });

  it('puts a task that is neither urgent nor important within 2 weeks', () => {
    // Busy every day for 10 days, free on day 11.
    const d = data(busyDays(0, 10, '23:55'), [task('later', { quadrant: 4, createdAt: `${D}T07:00:00Z` })]);
    expect(autoPlace(d, settings(), now)[0]!.blocks.map(where)).toEqual([`${day(11)} 08:00`]);
    // Nothing free for 15 days: not placed.
    const full = data(busyDays(0, 16, '23:55'), [task('later', { quadrant: 4, createdAt: `${D}T07:00:00Z` })]);
    expect(autoPlace(full, settings(), now)[0]!.blocks).toEqual([]);
  });

  it('gives an overdue task the same span again from today', () => {
    const d = data([], [task('old', { quadrant: 4, createdAt: '2026-10-01T09:00:00Z' })]);
    expect(autoPlace(d, settings(), now)[0]!.blocks.map(where)).toEqual([`${D} 08:00`]);
  });
});

describe('automatic prácticas end date', () => {
  const auto = (blocked: [string, 'non_school' | 'holiday'][] = []) => {
    const s = withPracticas(blocked);
    s.practicas.end = null;
    return s;
  };

  it('ends on the day the 500 h target is reached (125 days of 4 h)', () => {
    const s = auto();
    const h = practicasHours(s, '2026-10-01');
    expect(h.planned).toBe(500);
    // 1 Oct 2026 + 125 weekdays → Wednesday 24 Mar 2027.
    expect(h.end).toBe('2027-03-24');
    expect(buildDay('2027-03-24', data(), s, MORNING).busy.map((b) => b.kind)).toEqual(['practicas']);
    expect(buildDay('2027-03-25', data(), s, MORNING).busy).toEqual([]);
  });

  it('a blocked day pushes the end one working day later', () => {
    expect(practicasHours(auto([['2026-12-08', 'holiday']]), '2026-10-01').end).toBe('2027-03-25');
  });

  it('a fixed end date still wins', () => {
    const s = withPracticas();
    // 1 Oct 2026 → 1 Mar 2027 has 108 weekdays: 432 h, short of 500.
    expect(practicasHours(s, '2026-10-01')).toMatchObject({ end: '2027-03-01', planned: 432 });
  });

  it('a target that is not a multiple of the daily hours shortens the last day in the count', () => {
    const s = auto();
    s.practicas.totalHours = 10;
    expect(practicasHours(s, '2026-10-01')).toMatchObject({ planned: 10, end: '2026-10-05' });
  });
});

describe('hour factor', () => {
  it('4 h worked count as 5 h with 1.25, so 500 h take 100 days', () => {
    const s = withPracticas();
    s.practicas.end = null;
    s.practicas.hourFactor = 1.25;
    // 1 Oct 2026 + 100 weekdays → Wednesday 17 Feb 2027.
    expect(practicasHours(s, '2026-10-01')).toMatchObject({ planned: 500, end: '2027-02-17' });
    // 1-9 Oct = 7 days done on 12 Oct → 35 h logged.
    expect(practicasHours(s, '2026-10-12').done).toBe(35);
    // The day itself still blocks 09:00-13:00.
    expect(buildDay('2027-02-17', data(), s, MORNING).busy.map((b) => b.kind)).toEqual(['practicas']);
    expect(buildDay('2027-02-18', data(), s, MORNING).busy).toEqual([]);
  });
});

describe('practicasHours', () => {
  it('counts 4 h per prácticas day before today and skips blocked days', () => {
    const s = withPracticas([['2026-10-12', 'holiday']]);
    // 1-9 Oct 2026: Thu 1, Fri 2, Mon 5 … Fri 9 = 7 days; on 13 Oct: 7 + Tue 13? no (today excluded) → 1-9 Oct + Mon 12 blocked = 7 days.
    expect(practicasHours(s, '2026-10-13').done).toBe(28);
    expect(practicasHours(s, '2026-10-13').target).toBe(500);
  });
});

describe('week plan', () => {
  it('starts on the Monday of the week, Sunday included', () => {
    expect(weekStart('2026-11-18')).toBe('2026-11-16');
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
  });

  it('builds seven days with week totals and the longest slot', () => {
    const d = data([ev('other', at('2026-11-17', '08:00'), at('2026-11-17', '20:00'))]);
    const week = planWeek(D, d, settings(), MORNING);
    expect(week.days.map((x) => x.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    // 6 free days of 16 h, plus 4 h on Tuesday.
    expect(week.freeTotalMin).toBe(6 * 16 * 60 + 4 * 60);
    expect(week.busyTotalMin).toBe(12 * 60);
    expect(week.longestFree!.endMs - week.longestFree!.startMs).toBe(16 * 60 * 60_000);
  });

  it('matches the day plan for each day, auto-placed tasks included', () => {
    const now = at(D, '08:00');
    const d = data([ev('other', at(D, '08:30'), at(D, '20:00'))], [task('a', { durationMin: 120 })]);
    const week = planWeek(D, d, settings(), now);
    expect(week.days[2]).toEqual(planDay(D, d, settings(), now).plan);
    expect(week.placements).toHaveLength(1);
  });

  it('keeps the DST change day correct', () => {
    const week = planWeek('2027-03-28', data(), settings(), MORNING);
    expect(week.days[6]!.date).toBe('2027-03-28');
    expect(slots(week.days[6]!)).toEqual(['08:00-00:00']);
  });
});

describe('manual calendar entries', () => {
  const entry = (extra: Partial<EntryInput> = {}): EntryInput => ({
    id: 'r1',
    calendarId: 'gym',
    title: 'Gym',
    startMin: 19 * 60,
    endMin: 20 * 60 + 30,
    weekdays: [1, 3, 5],
    startDate: '2026-11-16',
    endDate: null,
    ...extra,
  });
  const withEntries = (entries: EntryInput[]): ScheduleData => ({ ...data(), entries });

  it('occurs only on its weekdays, inside its dates', () => {
    const e = entry({ endDate: '2026-11-27' });
    expect(entryOccurs(e, '2026-11-16')).toBe(true); // Monday
    expect(entryOccurs(e, '2026-11-17')).toBe(false); // Tuesday
    expect(entryOccurs(e, '2026-11-13')).toBe(false); // before the start
    expect(entryOccurs(e, '2026-11-27')).toBe(true); // last day (Friday)
    expect(entryOccurs(e, '2026-11-30')).toBe(false); // after the end
  });

  it('blocks its time with the calendar travel buffers', () => {
    // gym calendar: 30 min before and after.
    const plan = buildDay(D, withEntries([entry()]), settings(), MORNING);
    expect(plan.busy.map((b) => `${b.title} ${hm(b.startMs)}-${hm(b.endMs)}`)).toEqual(['Gym 19:00-20:30']);
    expect(plan.busy[0]!.entryId).toBe('r1');
    expect(slots(plan)).toEqual(['08:00-18:30', '21:00-00:00']);
  });

  it('leaves the other weekdays free', () => {
    const plan = buildDay('2026-11-17', withEntries([entry()]), settings(), MORNING);
    expect(plan.busy).toEqual([]);
    expect(slots(plan)).toEqual(['08:00-00:00']);
  });

  it('every day of the week, from one date', () => {
    const daily = entry({ weekdays: [1, 2, 3, 4, 5, 6, 7], startMin: 600, endMin: 660, calendarId: 'other' });
    const week = planWeek(D, withEntries([daily]), settings(), MORNING);
    expect(week.days.map((d) => d.busyTotalMin)).toEqual([60, 60, 60, 60, 60, 60, 60]);
  });

  it('a single date when start and end are the same day', () => {
    const once = entry({ weekdays: [3], startDate: D, endDate: D, calendarId: 'other' });
    expect(buildDay(D, withEntries([once]), settings(), MORNING).busy).toHaveLength(1);
    expect(buildDay('2026-11-25', withEntries([once]), settings(), MORNING).busy).toHaveLength(0);
  });

  it('a calendar that does not count as busy shows the entry as a note', () => {
    const cals = [...CALS, cal('info', 'other', 0, 0, false)];
    const d: ScheduleData = { ...data(), calendars: cals, entries: [entry({ calendarId: 'info' })] };
    const plan = buildDay(D, d, settings(), MORNING);
    expect(plan.busy).toEqual([]);
    expect(plan.notes.map((n) => n.title)).toEqual(['Gym']);
  });
});

describe('hidden titles', () => {
  it('drops events whose title is hidden for their calendar, whatever the case or spaces', () => {
    const cals = CALS.map((c) => (c.id === 'amorino' ? { ...c, hiddenTitles: ['día libre'] } : c));
    const d: ScheduleData = {
      ...data([
        ev('amorino', at(D, '08:00'), at(D, '23:59'), { title: '  Día   LIBRE ' }),
        ev('amorino', at(D, '19:00'), at(D, '21:00'), { title: 'Turno' }),
        ev('other', at(D, '10:00'), at(D, '11:00'), { title: 'Día libre' }),
      ]),
      calendars: cals,
    };
    const plan = buildDay(D, d, settings(), MORNING);
    expect(plan.busy.map((b) => b.title)).toEqual(['Día libre', 'Turno']);
    expect(plan.busy[0]!.calendarId).toBe('other');
  });
});

describe('work before deadlines', () => {
  const DUE = '2026-11-17';
  const workCals = (work = 360, max = 120) =>
    CALS.map((c) => (c.id === 'cesur' ? { ...c, deadlineWorkMin: work, deadlineDailyMaxMin: max } : c));
  const deadline = (date = DUE, title = 'Vencimiento de Tarea UT4') =>
    ev('cesur', at(date, '23:59'), at(date, '23:59'), { eventType: 'deadline', title });
  const withWork = (events: EventInput[], extra: Partial<ScheduleData> = {}, work?: number, max?: number): ScheduleData => ({
    ...data(events),
    calendars: workCals(work, max),
    ...extra,
  });
  const where = (b: { startMs: number; endMs: number }) => `${localDate(b.startMs, TZ)} ${hm(b.startMs)}-${hm(b.endMs)}`;

  it('places the work from the day before, going back, at most the daily max', () => {
    const plan = deadlineWork(withWork([deadline()]), settings());
    expect(plan.blocks.map(where)).toEqual(['2026-11-16 08:00-10:00', '2026-11-15 08:00-10:00', '2026-11-14 08:00-10:00']);
    expect(plan.blocks.every((b) => b.kind === 'focus' && b.deadlineId)).toBe(true);
    const [summary] = [...plan.deadlines.values()];
    expect(summary).toMatchObject({ totalMin: 360, plannedMin: 360, missingMin: 0, done: false });
  });

  it('skips days without free time and avoids small crumbs', () => {
    const events = [
      deadline(),
      ev('other', at('2026-11-16', '08:00'), at('2026-11-16', '23:45')), // only 15 min free
      ev('other', at('2026-11-15', '08:00'), at('2026-11-15', '23:00')), // 1 h free
    ];
    const plan = deadlineWork(withWork(events), settings());
    expect(plan.blocks.map(where)).toEqual([
      '2026-11-15 23:00-00:00',
      '2026-11-14 08:00-10:00',
      '2026-11-13 08:00-10:00',
      '2026-11-12 08:00-09:00',
    ]);
  });

  it('two deadlines share the free time, the earliest deadline first', () => {
    const plan = deadlineWork(withWork([deadline(DUE, 'B'), deadline('2026-11-16', 'A')], {}, 120), settings());
    expect(plan.blocks.map((b) => `${b.title} ${where(b)}`)).toEqual(['A 2026-11-15 08:00-10:00', 'B 2026-11-16 08:00-10:00']);
  });

  it('places nothing for a deadline marked done', () => {
    const d = deadline();
    const plan = deadlineWork(withWork([d], { doneDeadlines: [d.id] }), settings());
    expect(plan.blocks).toEqual([]);
    expect(plan.deadlines.get(d.id)).toMatchObject({ done: true, plannedMin: 0 });
  });

  it('reports the work that found no free time', () => {
    const busy = Array.from({ length: 61 }, (_, i) => {
      const day = addDays(DUE, -1 - i);
      return ev('other', at(day, '08:00'), at(day, '23:00'));
    });
    const plan = deadlineWork(withWork([deadline(), ...busy], {}, 360, 120), settings());
    // 1 h free each evening for 60 days: all 6 h fit, one hour per day.
    expect(plan.blocks).toHaveLength(6);
    const tight = deadlineWork(withWork([deadline(), ...busy], {}, 6000, 960), settings());
    expect([...tight.deadlines.values()][0]).toMatchObject({ plannedMin: 3600, missingMin: 2400 });
  });

  it('ignores calendars without work, other events and hidden deadlines', () => {
    const none = deadlineWork({ ...data([deadline()]) }, settings());
    expect(none.blocks).toEqual([]);
    const hidden = deadlineWork(
      { ...withWork([deadline()]), calendars: workCals().map((c) => (c.id === 'cesur' ? { ...c, hiddenTitles: ['vencimiento de tarea ut4'] } : c)) },
      settings(),
    );
    expect(hidden.blocks).toEqual([]);
    const notDeadline = deadlineWork(withWork([ev('cesur', at(DUE, '10:00'), at(DUE, '11:00'))]), settings());
    expect(notDeadline.blocks).toEqual([]);
  });

  it('shows the work in the day plan and keeps auto-placed tasks around it', () => {
    const now = at('2026-11-16', '07:00');
    const d = withWork([deadline()], { tasks: [task('a', { durationMin: 60 })] });
    const { plan, placements } = planDay('2026-11-16', d, settings(), now);
    expect(plan.busy.filter((b) => b.deadlineId).map(where)).toEqual(['2026-11-16 08:00-10:00']);
    expect(placements[0]!.blocks.map(where)).toEqual(['2026-11-16 10:00-11:00']);
  });
});
