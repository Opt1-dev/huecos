-- Phase 2: subjects and rendus (assignments), kept in step with "done"
-- deadlines so finished work frees its booked work time.

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color_index smallint not null default 0 check (color_index between 0 and 7),
  created_at timestamptz not null default now()
);
create unique index subjects_user_name_idx on public.subjects (user_id, lower(btrim(name)));
alter table public.subjects enable row level security;

revoke all on public.subjects from anon, authenticated;
grant select, delete on public.subjects to authenticated;
grant insert (name, color_index), update (name, color_index) on public.subjects to authenticated;
create policy "own subjects: read" on public.subjects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own subjects: add" on public.subjects
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own subjects: change" on public.subjects
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own subjects: remove" on public.subjects
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.rendus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The deadline event it comes from, if any. Kept when the event goes away.
  event_id uuid references public.events (id) on delete set null,
  -- A subject in use can't be deleted.
  subject_id uuid references public.subjects (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  due date not null,
  state text not null default 'todo' check (state in ('todo', 'done', 'submitted', 'graded')),
  grade numeric(4, 2) check (grade between 0 and 10),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rendus_event_idx on public.rendus (event_id) where event_id is not null;
create index rendus_user_due_idx on public.rendus (user_id, due);
create index rendus_subject_idx on public.rendus (subject_id);
alter table public.rendus enable row level security;

revoke all on public.rendus from anon, authenticated;
grant select, delete on public.rendus to authenticated;
grant insert (event_id, subject_id, title, due, state, grade, note) on public.rendus to authenticated;
grant update (subject_id, title, due, state, grade, note) on public.rendus to authenticated;

-- The linked event and subject must belong to the same user.
create policy "own rendus: read" on public.rendus
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own rendus: add" on public.rendus
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (event_id is null or exists (select 1 from public.events e where e.id = event_id and e.user_id = (select auth.uid())))
    and (subject_id is null or exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid())))
  );
create policy "own rendus: change" on public.rendus
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (subject_id is null or exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid())))
  );
create policy "own rendus: remove" on public.rendus
  for delete to authenticated using ((select auth.uid()) = user_id);

create trigger rendus_set_updated_at
  before update on public.rendus
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Rendu <-> done deadline. Both directions only change what differs, so the
-- two triggers never loop.
-- ---------------------------------------------------------------------------

-- A linked rendu that is done, submitted or graded marks its deadline done;
-- back to "todo", or deleted, unmarks it. Security definer: it only touches
-- the deadline of the rendu's own event, which RLS already tied to its owner.
create or replace function app_private.rendu_sync_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.event_id is not null then
      delete from public.deadline_done d where d.event_id = old.event_id;
    end if;
    return old;
  end if;
  if new.event_id is null then
    return new;
  end if;
  if new.state = 'todo' then
    delete from public.deadline_done d where d.event_id = new.event_id;
  else
    insert into public.deadline_done (event_id, user_id) values (new.event_id, new.user_id)
    on conflict (event_id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.rendu_sync_deadline() from public, anon, authenticated;
create trigger rendus_sync_deadline
  after insert or update of state or delete on public.rendus
  for each row execute function app_private.rendu_sync_deadline();

-- A deadline marked done moves its rendu from "todo" to "done" (creating the
-- rendu if there is none); unmarking moves "done" back to "todo".
-- Security definer for the same reason as above.
create or replace function app_private.deadline_sync_rendu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events%rowtype;
  tz text;
begin
  if tg_op = 'INSERT' then
    update public.rendus r set state = 'done' where r.event_id = new.event_id and r.state = 'todo';
    if not found and not exists (select 1 from public.rendus r where r.event_id = new.event_id) then
      select * into ev from public.events e where e.id = new.event_id;
      select s.timezone into tz from public.settings s where s.user_id = new.user_id;
      insert into public.rendus (user_id, event_id, title, due, state)
      values (
        new.user_id,
        new.event_id,
        coalesce(nullif(btrim(regexp_replace(ev.title, '^\s*vencimiento\s+de\s+', '', 'i')), ''), 'Rendu'),
        (ev.start_at at time zone coalesce(tz, 'Europe/Madrid'))::date,
        'done'
      );
    end if;
    return new;
  end if;
  update public.rendus r set state = 'todo' where r.event_id = old.event_id and r.state = 'done';
  return old;
end;
$$;
revoke execute on function app_private.deadline_sync_rendu() from public, anon, authenticated;
create trigger deadline_done_sync_rendu
  after insert or delete on public.deadline_done
  for each row execute function app_private.deadline_sync_rendu();

alter publication supabase_realtime add table public.subjects, public.rendus;
