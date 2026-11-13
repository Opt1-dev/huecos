-- Manual calendars: no .ics feed, the user types the entries in Huecos.
-- Each entry repeats on chosen weekdays between two dates (a single date when
-- start_date = end_date). Occurrences are expanded by the app, not stored.

alter table public.calendars
  add column source text not null default 'feed' check (source in ('feed', 'manual')),
  -- A manual calendar never gets a feed URL.
  add constraint calendars_manual_has_no_feed check (source = 'feed' or feed_secret_id is null);

-- `source` can be chosen when creating a calendar, never changed afterwards.
grant insert (source) on public.calendars to authenticated;

create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  calendar_id uuid not null references public.calendars (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  start_min smallint not null check (start_min between 0 and 1439),
  end_min smallint not null check (end_min between 1 and 1440),
  -- ISO weekdays, 1 = Monday … 7 = Sunday.
  weekdays smallint[] not null
    check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_min > start_min),
  check (end_date is null or end_date >= start_date)
);
create index calendar_entries_user_id_idx on public.calendar_entries (user_id);
create index calendar_entries_calendar_id_idx on public.calendar_entries (calendar_id);
alter table public.calendar_entries enable row level security;

revoke all on public.calendar_entries from anon, authenticated;
grant select, delete on public.calendar_entries to authenticated;
grant insert (calendar_id, title, start_min, end_min, weekdays, start_date, end_date)
  on public.calendar_entries to authenticated;
grant update (title, start_min, end_min, weekdays, start_date, end_date)
  on public.calendar_entries to authenticated;

create policy "own entries: read" on public.calendar_entries
  for select to authenticated using ((select auth.uid()) = user_id);
-- Only into one of the user's own manual calendars.
create policy "own entries: add" on public.calendar_entries
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.calendars c
      where c.id = calendar_id and c.user_id = (select auth.uid()) and c.source = 'manual'
    )
  );
create policy "own entries: change" on public.calendar_entries
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own entries: remove" on public.calendar_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger calendar_entries_set_updated_at
  before update on public.calendar_entries
  for each row execute function app_private.set_updated_at();

alter publication supabase_realtime add table public.calendar_entries;
