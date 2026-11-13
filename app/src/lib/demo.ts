// Dev-only sample data (loaded with ?demo on the Vite dev server) to check
// layouts without signing in. Never imported in production builds.
import type { Session } from '@supabase/supabase-js';
import { session } from './session';
import { blockedDays, calendars, entries, events, loaded, overrides, settingsRow, tasks, type EventRow } from './data';
import { addDays, localDate, zonedToUtc } from '../../../supabase/functions/_shared/tz.ts';

export function loadDemo(): void {
  const tz = 'Europe/Madrid';
  const today = localDate(Date.now(), tz);
  const iso = (d: string, min: number) => new Date(zonedToUtc(d, min, tz)).toISOString();
  session.value = { user: { id: 'demo' } } as unknown as Session;
  settingsRow.value = {
    user_id: 'demo',
    display_name: null,
    locale: 'fr',
    timezone: tz,
    day_start_min: 480,
    day_end_min: 1440,
    min_slot_min: 15,
    module_etudes: true,
    module_outlook: false,
    module_practicas: true,
    practicas_start: '2026-10-01',
    practicas_end: null,
    practicas_weekdays: [1, 2, 3, 4, 5],
    practicas_start_min: 540,
    practicas_end_min: 780,
    practicas_total_hours: 500,
    practicas_hour_factor: 1.25,
    practicas_buffer_before_min: 45,
    practicas_buffer_after_min: 75,
    last_synced_at: new Date().toISOString(),
  };
  entries.value = [
    { id: 'danse-1', calendar_id: 'danse', title: 'Salsa', start_min: 20 * 60, end_min: 21 * 60 + 30, weekdays: [2, 4], start_date: '2026-09-15', end_date: null },
    { id: 'danse-2', calendar_id: 'danse', title: 'Répétition', start_min: 11 * 60, end_min: 13 * 60, weekdays: [6, 7], start_date: addDays(today, -3), end_date: addDays(today, 30) },
  ];
  calendars.value = [
    { id: 'amorino', name: 'Amorino', role: 'work', color: '#b45309', buffer_before_min: 75, buffer_after_min: 0, counts_busy: true, sort_order: 0, source: 'feed', feed_host: 'combo.example', last_synced_at: new Date().toISOString(), last_error: null },
    { id: 'gym', name: 'Gymnasio', role: 'gym', color: '#047857', buffer_before_min: 30, buffer_after_min: 30, counts_busy: true, sort_order: 1, source: 'feed', feed_host: 'calendar.google.com', last_synced_at: new Date().toISOString(), last_error: null },
    { id: 'cesur', name: 'CESUR', role: 'school', color: '#6d28d9', buffer_before_min: 0, buffer_after_min: 0, counts_busy: true, sort_order: 2, source: 'feed', feed_host: 'calendar.google.com', last_synced_at: null, last_error: 'http_404' },
    { id: 'main', name: 'Principal', role: 'main', color: '#1d4ed8', buffer_before_min: 0, buffer_after_min: 0, counts_busy: true, sort_order: 3, source: 'feed', feed_host: null, last_synced_at: null, last_error: null },
    { id: 'danse', name: 'Cours de danse', role: 'activity', color: '#be185d', buffer_before_min: 20, buffer_after_min: 20, counts_busy: true, sort_order: 4, source: 'manual', feed_host: null, last_synced_at: null, last_error: null },
  ];
  const ev = (id: string, cal: string, title: string, d: string, s: number, e: number, extra: Partial<EventRow> = {}): EventRow => ({
    id, calendar_id: cal, title, start_at: iso(d, s), end_at: iso(d, e), all_day: false, event_type: 'event', status: 'confirmed', ...extra,
  });
  const days = [today, addDays(today, 1), addDays(today, 2)];
  events.value = days.flatMap((d, i) => [
    ev(`gym${i}`, 'gym', i % 2 ? 'Pull' : 'Push', d, 900, 1020),
    ev(`am${i}`, 'amorino', 'Turno Amorino', d, 1140, 1440 + 30),
    ev(`focus${i}`, 'main', 'Entrega DAW UT4', d, 1050, 1110, { event_type: 'focus' }),
    ev(`dl${i}`, 'cesur', 'Vencimiento de Tarea UT4 – Formularios', d, 1439, 1439, { event_type: 'deadline' }),
  ]);
  overrides.value = [];
  tasks.value = [
    { id: 't1', title: 'Préparer la présentation de projet', quadrant: 1, day: null, start_min: null, duration_min: 60, done: false, auto_placed: false, created_at: '2026-11-10T10:00:00Z' },
    { id: 't2', title: 'Appeler la banque', quadrant: 3, day: today, start_min: 840, duration_min: 15, done: true, auto_placed: false, created_at: '2026-11-10T10:00:00Z' },
    { id: 't3', title: 'Lire le chapitre 5 de Bases de datos', quadrant: 2, day: today, start_min: null, duration_min: 90, done: false, auto_placed: false, created_at: '2026-11-10T10:00:00Z' },
  ];
  blockedDays.value = [
    { date: '2026-12-07', kind: 'non_school' },
    { date: '2026-12-08', kind: 'holiday' },
  ];
  loaded.value = true;
}
