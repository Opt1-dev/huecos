// iCalendar parsing for sync-calendars: recurrences (RRULE, RDATE, EXDATE,
// RECURRENCE-ID overrides), all-day events, TZID vs UTC, STATUS:CANCELLED.
import ICAL from 'ical.js';
import { isValidTimeZone, localDate, zonedToUtc, MINUTE } from './tz.ts';

export type EventType = 'event' | 'focus' | 'deadline';
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';

export interface ParsedEvent {
  uid: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  status: EventStatus;
  eventType: EventType;
}

export interface ParseOptions {
  fromMs: number;
  toMs: number;
  /** Zone for all-day and floating times. */
  defaultTz: string;
  /** Role of the calendar, used to classify events. */
  role: string;
  /** Safety cap on occurrences per recurring event. */
  maxOccurrences?: number;
}

const DEADLINE_PREFIX = /^\s*vencimiento\s+de\s+/i;
const FOCUS_PREFIX = /^\s*entrega\b/i;

export function classify(title: string, role: string): EventType {
  if (role === 'deadlines' || DEADLINE_PREFIX.test(title)) return 'deadline';
  if (role === 'main' && FOCUS_PREFIX.test(title)) return 'focus';
  return 'event';
}

function toStatus(value: unknown): EventStatus {
  const s = String(value ?? '').toLowerCase();
  return s === 'cancelled' || s === 'tentative' ? s : 'confirmed';
}

function timeToMs(t: ICAL.Time, defaultTz: string): number {
  if (t.isDate) {
    const date = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    return zonedToUtc(date, 0, defaultTz);
  }
  const zone = t.zone;
  if (zone && zone.tzid === 'UTC') return t.toUnixTime() * 1000;
  if (zone && zone.tzid && zone.tzid !== 'floating') return t.toUnixTime() * 1000;
  // Floating, or a TZID without VTIMEZONE: read the wall clock in that zone.
  const named = (t as unknown as { timezone?: string }).timezone;
  const tz = isValidTimeZone(named) ? named : defaultTz;
  const date = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  return zonedToUtc(date, t.hour * 60 + t.minute, tz) + t.second * 1000;
}

function endFor(start: ICAL.Time, end: ICAL.Time | null, startMs: number, defaultTz: string): number {
  if (end) return Math.max(timeToMs(end, defaultTz), startMs);
  // No DTEND/DURATION: all-day lasts one day, timed events are instants.
  if (start.isDate) {
    const d = localDate(startMs + 12 * 60 * MINUTE, defaultTz);
    return zonedToUtc(d, 1440, defaultTz);
  }
  return startMs;
}

export function parseIcs(text: string, opts: ParseOptions): ParsedEvent[] {
  const max = opts.maxOccurrences ?? 1000;
  const root = new ICAL.Component(ICAL.parse(text));
  const vevents = root.getAllSubcomponents('vevent');

  const masters = new Map<string, ICAL.Event>();
  const orphans: ICAL.Event[] = [];
  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    if (!ev.uid) continue;
    if (ev.isRecurrenceException()) orphans.push(ev);
    else masters.set(ev.uid, ev);
  }
  const standalone: ICAL.Event[] = [];
  for (const ex of orphans) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else standalone.push(ex);
  }

  const out: ParsedEvent[] = [];
  const push = (uid: string, item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null) => {
    const startMs = timeToMs(start, opts.defaultTz);
    const endMs = endFor(start, end, startMs, opts.defaultTz);
    if (endMs < opts.fromMs || startMs > opts.toMs) return;
    const title = (item.summary ?? '').trim();
    out.push({
      uid,
      title,
      startMs,
      endMs,
      allDay: start.isDate,
      status: toStatus(item.component.getFirstPropertyValue('status')),
      eventType: classify(title, opts.role),
    });
  };

  for (const ev of [...masters.values(), ...standalone]) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      push(ev.uid, ev, ev.startDate, ev.endDate ?? null);
      continue;
    }
    const it = ev.iterator();
    let count = 0;
    for (let next = it.next(); next && count < max; next = it.next(), count++) {
      if (timeToMs(next, opts.defaultTz) > opts.toMs) break;
      const details = ev.getOccurrenceDetails(next);
      push(ev.uid, details.item, details.startDate, details.endDate ?? null);
    }
  }
  return out;
}
