import { locale, t, type MessageKey } from '../i18n';
import { pad } from '../../../supabase/functions/_shared/tz.ts';

export function durationLabel(totalMin: number): string {
  const tr = t.value;
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h && m) return tr('duration.hm', { h, m: pad(m) });
  if (h) return tr('duration.h', { h });
  return tr('duration.m', { m });
}

export function timeLabel(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(locale.value, { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
}

export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(y!, m! - 1, d!),
  );
}

export function weekdayShort(isoDay: number): string {
  // 2024-01-01 is a Monday.
  return new Intl.DateTimeFormat(locale.value, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2024, 0, isoDay));
}

/** "HH:MM" → minutes since midnight, or null. */
export function parseTimeInput(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function minutesToInput(min: number): string {
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
}

export function feedErrorMessage(code: string): string {
  const tr = t.value;
  if (code.startsWith('url_')) return code === 'url_host' ? tr('feedErr.host') : tr('feedErr.url');
  if (code === 'blocked_host') return tr('feedErr.host');
  if (code === 'not_ics') return tr('feedErr.notIcs');
  if (code === 'too_large') return tr('feedErr.tooLarge');
  return tr('feedErr.unreachable', { code });
}

export function errorText(e: unknown): string {
  return t.value('common.error', { message: e instanceof Error ? e.message : String(e) });
}

export const QUADRANT_KEYS: Record<1 | 2 | 3 | 4, MessageKey> = { 1: 'q.1', 2: 'q.2', 3: 'q.3', 4: 'q.4' };
