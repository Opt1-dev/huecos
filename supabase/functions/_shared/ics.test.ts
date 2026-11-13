import { describe, expect, it } from 'vitest';
import { classify, parseIcs } from './ics.ts';

const TZ = 'Europe/Madrid';
const window = { fromMs: Date.parse('2026-11-01T00:00:00Z'), toMs: Date.parse('2026-12-31T00:00:00Z'), defaultTz: TZ };
const iso = (ms: number) => new Date(ms).toISOString();

const VTZ = `BEGIN:VTIMEZONE
TZID:Europe/Madrid
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`;

const cal = (body: string, tz = VTZ) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${tz}\r\n${body}\r\nEND:VCALENDAR\r\n`.replace(/\r?\n/g, '\r\n');

describe('parseIcs', () => {
  it('reads TZID times through the embedded VTIMEZONE and UTC times as UTC', () => {
    const events = parseIcs(
      cal(`BEGIN:VEVENT
UID:a
SUMMARY:Turno
DTSTART;TZID=Europe/Madrid:20261120T180000
DTEND;TZID=Europe/Madrid:20261121T010000
END:VEVENT
BEGIN:VEVENT
UID:b
SUMMARY:Call
DTSTART:20261120T090000Z
DTEND:20261120T100000Z
END:VEVENT`),
      { ...window, role: 'work' },
    );
    const a = events.find((e) => e.uid === 'a')!;
    expect(iso(a.startMs)).toBe('2026-11-20T17:00:00.000Z');
    expect(iso(a.endMs)).toBe('2026-11-21T00:00:00.000Z');
    const b = events.find((e) => e.uid === 'b')!;
    expect(iso(b.startMs)).toBe('2026-11-20T09:00:00.000Z');
  });

  it('falls back to the IANA name when a TZID has no VTIMEZONE', () => {
    const [e] = parseIcs(
      cal(`BEGIN:VEVENT
UID:c
DTSTART;TZID=Europe/Madrid:20261120T090000
DTEND;TZID=Europe/Madrid:20261120T130000
END:VEVENT`, ''),
      { ...window, role: 'practicas' },
    );
    expect(iso(e!.startMs)).toBe('2026-11-20T08:00:00.000Z');
  });

  it('expands RRULE, skips EXDATE and applies RECURRENCE-ID changes', () => {
    const events = parseIcs(
      cal(`BEGIN:VEVENT
UID:gym
SUMMARY:Gym
DTSTART;TZID=Europe/Madrid:20261102T150000
DTEND;TZID=Europe/Madrid:20261102T170000
RRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=6
EXDATE;TZID=Europe/Madrid:20261105T150000
END:VEVENT
BEGIN:VEVENT
UID:gym
RECURRENCE-ID;TZID=Europe/Madrid:20261109T150000
SUMMARY:Gym (late)
DTSTART;TZID=Europe/Madrid:20261109T180000
DTEND;TZID=Europe/Madrid:20261109T200000
END:VEVENT`),
      { ...window, role: 'gym' },
    );
    expect(events).toHaveLength(5);
    expect(events.map((e) => iso(e.startMs))).not.toContain('2026-11-05T14:00:00.000Z');
    const moved = events.find((e) => e.title === 'Gym (late)')!;
    expect(iso(moved.startMs)).toBe('2026-11-09T17:00:00.000Z');
  });

  it('keeps all-day events on the local day and marks them', () => {
    const [e] = parseIcs(
      cal(`BEGIN:VEVENT
UID:d
SUMMARY:Vencimiento de Tarea 3
DTSTART;VALUE=DATE:20261201
DTEND;VALUE=DATE:20261202
END:VEVENT`),
      { ...window, role: 'school' },
    );
    expect(e!.allDay).toBe(true);
    expect(iso(e!.startMs)).toBe('2026-11-30T23:00:00.000Z');
    expect(iso(e!.endMs)).toBe('2026-12-01T23:00:00.000Z');
    expect(e!.eventType).toBe('deadline');
  });

  it('reports STATUS:CANCELLED and drops events outside the window', () => {
    const events = parseIcs(
      cal(`BEGIN:VEVENT
UID:e
STATUS:CANCELLED
DTSTART:20261120T090000Z
DTEND:20261120T100000Z
END:VEVENT
BEGIN:VEVENT
UID:old
DTSTART:20250101T090000Z
DTEND:20250101T100000Z
END:VEVENT`),
      { ...window, role: 'other' },
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('cancelled');
  });
});

describe('classify', () => {
  it('detects deadlines and study blocks', () => {
    expect(classify('Vencimiento de UT4 práctica', 'school')).toBe('deadline');
    expect(classify('Entrega DAW UT3', 'main')).toBe('focus');
    expect(classify('Entrega DAW UT3', 'school')).toBe('event');
    expect(classify('Anything', 'deadlines')).toBe('deadline');
  });
});
