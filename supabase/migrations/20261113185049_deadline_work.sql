-- Work time before deadlines: each deadline of a calendar needs
-- deadline_work_min of work, placed by the app in free time before the day of
-- the deadline, at most deadline_daily_max_min per day. 0 = off.
alter table public.calendars
  add column deadline_work_min smallint not null default 0 check (deadline_work_min between 0 and 6000),
  add column deadline_daily_max_min smallint not null default 120 check (deadline_daily_max_min between 15 and 960);

grant update (deadline_work_min, deadline_daily_max_min) on public.calendars to authenticated;

-- Deadlines marked done: their remaining work is no longer placed.
create table public.deadline_done (
  event_id uuid primary key references public.events (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index deadline_done_user_id_idx on public.deadline_done (user_id);
alter table public.deadline_done enable row level security;

revoke all on public.deadline_done from anon, authenticated;
grant select, delete on public.deadline_done to authenticated;
grant insert (event_id) on public.deadline_done to authenticated;

create policy "own done deadlines: read" on public.deadline_done
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own done deadlines: add" on public.deadline_done
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid()))
  );
create policy "own done deadlines: remove" on public.deadline_done
  for delete to authenticated using ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.deadline_done;
