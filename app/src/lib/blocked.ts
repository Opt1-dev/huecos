import type { BlockedKind } from '../engine/schedule';

const HOLIDAY_WORDS = /(f[ée]ri[ée]|festivo|fiesta|holiday|rouge|red)/i;

/**
 * Parse pasted blocked days: one per line, "YYYY-MM-DD" or "DD/MM/YYYY",
 * optional words marking a holiday. Invalid lines are skipped; duplicates keep the last.
 */
export function parseBlockedDays(text: string): { date: string; kind: BlockedKind }[] {
  const out = new Map<string, BlockedKind>();
  for (const line of text.split(/\r?\n/)) {
    const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(line);
    const eu = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(line);
    let y: number, m: number, d: number;
    if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (eu) [y, m, d] = [Number(eu[3]), Number(eu[2]), Number(eu[1])];
    else continue;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) continue;
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    out.set(date, HOLIDAY_WORDS.test(line) ? 'holiday' : 'non_school');
  }
  return [...out].map(([date, kind]) => ({ date, kind })).sort((a, b) => a.date.localeCompare(b.date));
}
