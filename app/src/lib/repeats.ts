import { normalizeTitle } from '../engine/schedule';

export interface TitleRow {
  title: string;
  all_day: boolean;
  start_at: string;
  end_at: string;
}

export interface RepeatedTitle {
  /** Title as written in the feed (first occurrence). */
  title: string;
  count: number;
  /** Every occurrence covers a whole day. */
  allDay: boolean;
  /** Looks like a day off or holidays: pre-ticked in the dialog. */
  suggested: boolean;
}

const LETTER = String.raw`\p{L}`;
const REST_WORDS = [
  'descanso',
  'libre',
  'libranza',
  'vacaciones',
  'vacaci[oó]n',
  'vacances?',
  'repos',
  'cong[ée]s?',
  'festivo',
  'f[ée]ri[ée]',
  'r[ée]cup[ée]ration',
  'baja',
  'off',
  'day off',
  'holidays?',
  'leave',
  'rest',
];
const REST = new RegExp(`(?<!${LETTER})(${REST_WORDS.join('|')})(?!${LETTER})`, 'iu');
const WHOLE_DAY_MS = 20 * 60 * 60 * 1000;

/** True for titles that read like a day off, holidays or leave. */
export function looksLikeTimeOff(title: string): boolean {
  return REST.test(title);
}

/**
 * Titles used by at least `min` events of a calendar, most likely "day off"
 * ones first, then the most frequent. Already hidden titles are left out.
 */
export function repeatedTitles(rows: readonly TitleRow[], hidden: readonly string[], min = 2): RepeatedTitle[] {
  const skip = new Set(hidden.map(normalizeTitle));
  const groups = new Map<string, { title: string; count: number; allDay: boolean }>();
  for (const r of rows) {
    const key = normalizeTitle(r.title);
    if (!key || skip.has(key)) continue;
    const whole = r.all_day || Date.parse(r.end_at) - Date.parse(r.start_at) >= WHOLE_DAY_MS;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.allDay &&= whole;
    } else {
      groups.set(key, { title: r.title.trim().replace(/\s+/g, ' '), count: 1, allDay: whole });
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= min)
    .map((g) => ({ ...g, suggested: g.allDay || looksLikeTimeOff(g.title) }))
    .sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, 30);
}
