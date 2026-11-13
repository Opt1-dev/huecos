import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday, localDate, minutesSinceMidnight, tzOffsetMs, zonedToUtc } from './tz.ts';

const TZ = 'Europe/Madrid';
const iso = (ms: number) => new Date(ms).toISOString();

describe('zonedToUtc', () => {
  it('winter: 08:00 Madrid is 07:00 UTC', () => {
    expect(iso(zonedToUtc('2026-11-13', 480, TZ))).toBe('2026-11-13T07:00:00.000Z');
  });
  it('summer: 08:00 Madrid is 06:00 UTC', () => {
    expect(iso(zonedToUtc('2027-06-01', 480, TZ))).toBe('2027-06-01T06:00:00.000Z');
  });
  it('DST day 28 Mar 2027: 01:00 is CET, 08:00 is CEST', () => {
    expect(iso(zonedToUtc('2027-03-28', 60, TZ))).toBe('2027-03-28T00:00:00.000Z');
    expect(iso(zonedToUtc('2027-03-28', 480, TZ))).toBe('2027-03-28T06:00:00.000Z');
  });
  it('minutes past 24:00 roll into the next day', () => {
    expect(iso(zonedToUtc('2026-11-13', 1440 + 120, TZ))).toBe('2026-11-14T01:00:00.000Z');
  });
  it('a time in the spring-forward gap lands after the gap', () => {
    // 02:30 does not exist on 28 Mar 2027; it becomes 03:30 CEST = 01:30 UTC.
    expect(iso(zonedToUtc('2027-03-28', 150, TZ))).toBe('2027-03-28T01:30:00.000Z');
  });
});

describe('helpers', () => {
  it('localDate and minutesSinceMidnight read the wall clock', () => {
    const ms = Date.parse('2026-11-13T23:30:00Z'); // 00:30 on the 14th in Madrid
    expect(localDate(ms, TZ)).toBe('2026-11-14');
    expect(minutesSinceMidnight(ms, TZ)).toBe(30);
  });
  it('offset is +1 h in winter and +2 h in summer', () => {
    expect(tzOffsetMs(Date.parse('2026-12-01T12:00:00Z'), TZ)).toBe(3_600_000);
    expect(tzOffsetMs(Date.parse('2027-07-01T12:00:00Z'), TZ)).toBe(7_200_000);
  });
  it('addDays and isoWeekday', () => {
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoWeekday('2026-11-16')).toBe(1); // Monday
    expect(isoWeekday('2027-03-28')).toBe(7); // Sunday
  });
});
