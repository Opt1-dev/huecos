-- Phase 1: calendars with private feed URLs, synced events, overrides, tasks,
-- blocked days, prácticas settings, realtime and the 15-minute sync job.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Settings: prácticas module.
-- ---------------------------------------------------------------------------
alter table public.settings
  add column practicas_start date,
  add column practicas_end date,
  add column practicas_weekdays smallint[] not null default '{1,2,3,4,5}'
    check (practicas_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  add column practicas_start_min smallint not null default 540 check (practicas_start_min between 0 and 1439),
  add column practicas_end_min smallint not null default 780 check (practicas_end_min between 1 and 1440),
  add column practicas_total_hours smallint not null default 500 check (practicas_total_hours between 1 and 5000),
  add column practicas_buffer_before_min smallint not null default 45 check (practicas_buffer_before_min between 0 and 240),
  add column practicas_buffer_after_min smallint not null default 75 check (practicas_buffer_after_min between 0 and 240),
  add column last_synced_at timestamptz,
  add constraint settings_practicas_range check (practicas_start_min < practicas_end_min),
  add constraint settings_practicas_dates check (practicas_end is null or practicas_start is null or practicas_start <= practicas_end);

-- ---------------------------------------------------------------------------
-- Calendars. The feed URL is a credential: it lives in Vault and is only set
-- by the save-feed Edge Function; the browser only sees feed_host.
-- ---------------------------------------------------------------------------
create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  role text not null default 'other'
    check (role in ('practicas', 'work', 'school', 'gym', 'activity', 'deadlines', 'main', 'other')),
  color text not null default '#5b8def' check (color ~ '^#[0-9a-fA-F]{6}$'),
  buffer_before_min smallint not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min smallint not null default 0 check (buffer_after_min between 0 and 240),
  counts_busy boolean not null default true,
  sort_order smallint not null default 0,
  feed_secret_id uuid,
  feed_host text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index calendars_user_id_idx on public.calendars (user_id);
alter table public.calendars enable row level security;

revoke all on public.calendars from anon, authenticated;
grant select on public.calendars to authenticated;
grant insert (name, role, color, buffer_before_min, buffer_after_min, counts_busy, sort_order)
  on public.calendars to authenticated;
grant update (name, role, color, buffer_before_min, buffer_after_min, counts_busy, sort_order)
  on public.calendars to authenticated;
grant delete on public.calendars to authenticated;

create policy "own calendars: read" on public.calendars
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own calendars: add" on public.calendars
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own calendars: change" on public.calendars
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own calendars: remove" on public.calendars
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Remove the Vault secret together with its calendar.
create or replace function app_private.delete_calendar_feed_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.feed_secret_id is not null then
    delete from vault.secrets where id = old.feed_secret_id;
  end if;
  return old;
end;
$$;
revoke execute on function app_private.delete_calendar_feed_secret() from public, anon, authenticated;
create trigger calendars_delete_feed_secret
  after delete on public.calendars
  for each row execute function app_private.delete_calendar_feed_secret();

-- Service-only: store or replace a calendar's feed URL (called by save-feed).
create or replace function public.set_calendar_feed(p_calendar_id uuid, p_user_id uuid, p_url text, p_host text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
begin
  select c.feed_secret_id into existing
  from public.calendars c
  where c.id = p_calendar_id and c.user_id = p_user_id
  for update;
  if not found then
    raise exception 'calendar not found' using errcode = 'P0002';
  end if;

  if existing is null then
    existing := vault.create_secret(p_url, 'calendar_feed_' || p_calendar_id::text, 'Huecos calendar feed');
  else
    perform vault.update_secret(existing, p_url);
  end if;

  update public.calendars
  set feed_secret_id = existing, feed_host = p_host, last_error = null
  where id = p_calendar_id;
end;
$$;
revoke execute on function public.set_calendar_feed(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_calendar_feed(uuid, uuid, text, text) to service_role;

-- Service-only: feeds to fetch, optionally for one user.
create or replace function public.calendar_feeds_for_sync(p_user_id uuid default null)
returns table (calendar_id uuid, user_id uuid, role text, url text, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.user_id, c.role, s.decrypted_secret, coalesce(st.timezone, 'Europe/Madrid')
  from public.calendars c
  join vault.decrypted_secrets s on s.id = c.feed_secret_id
  left join public.settings st on st.user_id = c.user_id
  where p_user_id is null or c.user_id = p_user_id;
$$;
revoke execute on function public.calendar_feeds_for_sync(uuid) from public, anon, authenticated;
grant execute on function public.calendar_feeds_for_sync(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Events: written only by sync-calendars (service role), read by the owner.
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  uid text not null,
  title text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  event_type text not null default 'event' check (event_type in ('event', 'focus', 'deadline')),
  status text not null default 'confirmed' check (status in ('confirmed', 'tentative', 'cancelled')),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at),
  unique (calendar_id, uid, start_at)
);
create index events_user_start_idx on public.events (user_id, start_at);
create index events_calendar_start_idx on public.events (calendar_id, start_at);
alter table public.events enable row level security;

revoke all on public.events from anon, authenticated;
grant select on public.events to authenticated;
create policy "own events: read" on public.events
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Overrides: move or cancel an event in Huecos only (the source is untouched).
-- ---------------------------------------------------------------------------
create table public.overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid not null unique references public.events (id) on delete cascade,
  start_at timestamptz,
  end_at timestamptz,
  cancelled boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((start_at is null) = (end_at is null)),
  check (end_at is null or end_at > start_at)
);
create index overrides_user_id_idx on public.overrides (user_id);
alter table public.overrides enable row level security;

revoke all on public.overrides from anon, authenticated;
grant select, insert, update, delete on public.overrides to authenticated;
create policy "own overrides: read" on public.overrides
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own overrides: add" on public.overrides
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
  );
create policy "own overrides: change" on public.overrides
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
  );
create policy "own overrides: remove" on public.overrides
  for delete to authenticated using ((select auth.uid()) = user_id);
create trigger overrides_set_updated_at
  before update on public.overrides
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tasks. quadrant: 1 urgent+important, 2 important, 3 urgent, 4 neither.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  quadrant smallint not null default 1 check (quadrant between 1 and 4),
  day date,
  start_min smallint check (start_min between 0 and 1439),
  duration_min smallint not null default 30 check (duration_min between 15 and 240),
  done boolean not null default false,
  auto_placed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_min is null or day is not null)
);
create index tasks_user_day_idx on public.tasks (user_id, day);
alter table public.tasks enable row level security;

revoke all on public.tasks from anon, authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
create policy "own tasks: read" on public.tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own tasks: add" on public.tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own tasks: change" on public.tasks
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own tasks: remove" on public.tasks
  for delete to authenticated using ((select auth.uid()) = user_id);
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Blocked days (no prácticas): non-school days and holidays.
-- ---------------------------------------------------------------------------
create table public.blocked_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('non_school', 'holiday')),
  primary key (user_id, date)
);
alter table public.blocked_days enable row level security;

revoke all on public.blocked_days from anon, authenticated;
grant select, insert, update, delete on public.blocked_days to authenticated;
create policy "own blocked days: read" on public.blocked_days
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own blocked days: add" on public.blocked_days
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own blocked days: change" on public.blocked_days
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own blocked days: remove" on public.blocked_days
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Realtime: keep phone and laptop in sync.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.tasks, public.overrides;

-- ---------------------------------------------------------------------------
-- Sync every 15 minutes. Needs two Vault secrets created once (see README):
-- huecos_project_url and huecos_sync_cron_secret.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'huecos-sync-calendars',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'huecos_project_url')
      || '/functions/v1/sync-calendars',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'huecos_sync_cron_secret')
    ),
    body := '{"scope":"all"}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'huecos_sync_cron_secret');
  $job$
);

-- ---------------------------------------------------------------------------
-- Tighten Phase 0 grants: Supabase's default privileges also give TRUNCATE,
-- REFERENCES and TRIGGER; keep only what the policies are written for.
-- ---------------------------------------------------------------------------
revoke all on public.invitations from anon, authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
revoke all on public.settings from anon, authenticated;
grant select, update on public.settings to authenticated;
