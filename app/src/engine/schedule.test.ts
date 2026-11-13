import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '../../../supabase/functions/_shared/tz.ts';
import {
  autoPlace,
  buildDay,
  mergeIntervals,
  planDay,
  practicasHours,
  type CalendarInfo,
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
  it('puts an urgent+important task in the first slot long enough', () => {
    const now = at(D, '08:00');
    const d = data([ev('other', at(D, '08:30'), at(D, '20:00'))], [task('a', { durationMin: 120 })]);
    const [placement] = autoPlace(d, settings(), now);
    expect(hm(placement!.block!.startMs)).toBe('20:00');
    const { plan } = planDay(D, d, settings(), now);
    expect(plan.busy.some((b) => b.autoPlaced)).toBe(true);
    expect(slots(plan)).toEqual(['08:00-08:30', '22:00-00:00']);
  });

  it('ignores other quadrants, done tasks and tasks with a time', () => {
    const d = data([], [task('b', { quadrant: 2 }), task('c', { done: true }), task('dd', { day: D, startMin: 600 })]);
    expect(autoPlace(d, settings(), MORNING)).toEqual([]);
  });

  it('returns null when nothing fits within 48 h', () => {
    const now = at(D, '08:00');
    const busyAllWeek = [0, 1, 2, 3].map((i) => {
      const day = `2026-11-${18 + i}`;
      return ev('other', at(day, '08:00'), at(day, '23:55'));
    });
    const [placement] = autoPlace(data(busyAllWeek, [task('x', { durationMin: 30 })]), settings(), now);
    expect(placement).toEqual({ taskId: 'x', block: null });
  });

  it('places several tasks one after another', () => {
    const now = at(D, '08:00');
    const out = autoPlace(data([], [task('p', { durationMin: 60 }), task('qq', { durationMin: 30 })]), settings(), now);
    expect(out.map((p) => hm(p.block!.startMs))).toEqual(['08:00', '09:00']);
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
