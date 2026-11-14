// Dev-only sample data (loaded with ?demo on the Vite dev server) to check
// layouts without signing in. Never imported in production builds.
import type { Session } from '@supabase/supabase-js';
import { session } from './session';
import { blockedDays, calendars, entries, events, loaded, notes, overrides, rendus, settingsRow, subjects, tasks, type EventRow } from './data';
import { addDays, localDate, zonedToUtc } from '../../../supabase/functions/_shared/tz.ts';
import { mailAccounts, mailHits, mailKeywords } from './mail';

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
    { id: 'amorino', name: 'Amorino', role: 'work', color: '#b45309', buffer_before_min: 75, buffer_after_min: 0, counts_busy: true, sort_order: 0, source: 'feed', hidden_titles: [], deadline_work_min: 0, deadline_daily_max_min: 120, feed_host: 'combo.example', last_synced_at: new Date().toISOString(), last_error: null },
    { id: 'gym', name: 'Gymnasio', role: 'gym', color: '#047857', buffer_before_min: 30, buffer_after_min: 30, counts_busy: true, sort_order: 1, source: 'feed', hidden_titles: [], deadline_work_min: 0, deadline_daily_max_min: 120, feed_host: 'calendar.google.com', last_synced_at: new Date().toISOString(), last_error: null },
    { id: 'cesur', name: 'CESUR', role: 'school', color: '#6d28d9', buffer_before_min: 0, buffer_after_min: 0, counts_busy: true, sort_order: 2, source: 'feed', hidden_titles: [], deadline_work_min: 240, deadline_daily_max_min: 120, feed_host: 'calendar.google.com', last_synced_at: null, last_error: 'http_404' },
    { id: 'main', name: 'Principal', role: 'main', color: '#1d4ed8', buffer_before_min: 0, buffer_after_min: 0, counts_busy: true, sort_order: 3, source: 'feed', hidden_titles: [], deadline_work_min: 0, deadline_daily_max_min: 120, feed_host: null, last_synced_at: null, last_error: null },
    { id: 'danse', name: 'Cours de danse', role: 'activity', color: '#be185d', buffer_before_min: 20, buffer_after_min: 20, counts_busy: true, sort_order: 4, source: 'manual', hidden_titles: [], deadline_work_min: 0, deadline_daily_max_min: 120, feed_host: null, last_synced_at: null, last_error: null },
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
  ]).concat(
    // Days off exported by the shift app as big timed blocks.
    [3, 4, 10].map((n) => ev(`off${n}`, 'amorino', 'Día libre', addDays(today, n), 480, 1440)),
  );
  subjects.value = [
    { id: 's1', name: 'DEWES', color_index: 0 },
    { id: 's2', name: 'Despliegue AW', color_index: 1 },
    { id: 's3', name: 'Inglés', color_index: 2 },
    { id: 's4', name: 'Ciberseguridad', color_index: 3 },
  ];
  const r = (id: string, extra: Record<string, unknown>) => ({
    id, event_id: null, subject_id: null, title: id, due: today, state: 'todo', grade: null, note: '',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
  }) as (typeof rendus.value)[number];
  rendus.value = [
    r('g1', { subject_id: 's1', title: 'Selección de arquitecturas', due: '2026-10-06', state: 'graded', grade: 10 }),
    r('g2', { subject_id: 's1', title: 'Prueba abierta UD02', due: '2026-10-27', state: 'graded', grade: 7.86 }),
    r('g3', { subject_id: 's3', title: 'Prueba abierta UD01', due: '2026-10-12', state: 'graded', grade: 9.35 }),
    r('g4', { subject_id: 's4', title: 'Prueba Abierta UD01', due: '2026-10-12', state: 'graded', grade: 9.75 }),
    r('g5', { subject_id: 's4', title: 'Prueba Abierta UD02', due: '2026-11-09', state: 'graded', grade: 6.5 }),
    r('g6', { subject_id: 's2', title: 'Prueba Abierta UD01', due: '2026-11-05', state: 'graded', grade: 5 }),
    r('g7', { subject_id: 's3', title: 'Prueba abierta UD02', due: '2026-11-09', state: 'graded', grade: 10 }),
    r('p1', { subject_id: 's2', title: 'Prueba Abierta 1 UD02', due: addDays(today, -4), state: 'submitted' }),
    r('d1', { subject_id: 's1', title: 'Proyecto: maquetación', due: addDays(today, -1), state: 'done' }),
    r('t1', { subject_id: 's3', title: 'Writing task', due: addDays(today, 5), state: 'todo', note: 'Relire le sujet' }),
  ];
  notes.value = [
    { id: 'n1', subject_id: null, title: 'Idées de week-end', body: 'Randonnée à la Sierra\nMarché de Ruzafa samedi matin', pinned: true, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-08T10:00:00Z' },
    { id: 'n2', subject_id: 's1', title: 'Formulaires : points clés', body: 'Valider côté serveur aussi.\nUtiliser les labels pour chaque champ.\nTester avec le clavier.', pinned: false, created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-12T18:30:00Z' },
    { id: 'n3', subject_id: 's3', title: 'Vocabulary', body: 'deadline, handed in, feedback', pinned: false, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-21T09:00:00Z' },
    { id: 'n4', subject_id: 's1', title: 'Formulaires : validation', body: 'Messages d’erreur à côté du champ.', pinned: false, created_at: '2026-11-06T10:00:00Z', updated_at: '2026-11-09T10:00:00Z' },
    { id: 'n5', subject_id: null, title: 'Logo The Buffer Club', body: 'Trois pistes : typographique, pictogramme, mixte.', pinned: false, created_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-10T10:00:00Z' },
    { id: 'n6', subject_id: null, title: 'Couleurs du logo', body: 'Vert sauge, crème, noir.', pinned: false, created_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-07T10:00:00Z' },
    { id: 'n7', subject_id: null, title: 'The Buffer Club : réunion', body: 'Jeudi 19 h.', pinned: false, created_at: '2026-11-04T10:00:00Z', updated_at: '2026-11-06T10:00:00Z' },
    { id: 'n8', subject_id: 's2', title: 'Projet DAW : idées', body: 'Gestion de réservations ?', pinned: false, created_at: '2026-10-25T10:00:00Z', updated_at: '2026-10-30T10:00:00Z' },
    { id: 'n9', subject_id: 's2', title: 'Projet DAW : planning', body: 'Maquettes en novembre, code en décembre.', pinned: false, created_at: '2026-10-26T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' },
  ];
  mailAccounts.value = [
    { id: 'mb1', provider: 'microsoft', address: 'tomas@cesur.example', last_checked_at: new Date().toISOString(), last_error: null, created_at: '2026-11-10T10:00:00Z' },
  ];
  mailKeywords.value = [
    { id: 'k1', keyword: 'retroalimentación', sender: 'cesurformacion.com' },
    { id: 'k2', keyword: 'urgent', sender: null },
  ];
  mailHits.value = [
    { id: 'h1', account_id: 'mb1', subject: 'María López ha hecho un comentario en la tarea UT4 – Formularios', sender_name: 'Plataforma CESUR', sender_address: 'noreply-plataforma@cesurformacion.com', received_at: iso(today, 9 * 60 + 12), snippet: '…la profesora ha aportado alguna retroalimentación en su entrega de la tarea UT4 – Formularios. Puede consultarla en…', keywords: ['retroalimentación'], web_link: 'https://outlook.office.com/mail/', done: false },
    { id: 'h2', account_id: 'mb1', subject: 'Cambio de horario – urgent', sender_name: 'Secretaría', sender_address: 'secretaria@cesur.example', received_at: iso(addDays(today, -1), 17 * 60 + 40), snippet: 'Cambio de horario – urgent', keywords: ['urgent'], web_link: 'https://outlook.office.com/mail/', done: false },
    { id: 'h3', account_id: 'mb1', subject: 'Juan Pérez ha hecho un comentario en la tarea UT2', sender_name: 'Plataforma CESUR', sender_address: 'noreply-plataforma@cesurformacion.com', received_at: iso(addDays(today, -4), 11 * 60), snippet: '…ha aportado alguna retroalimentación en su entrega…', keywords: ['retroalimentación'], web_link: null, done: true },
  ];
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
