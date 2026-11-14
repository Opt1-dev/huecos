-- Phase 3: notes. A note may belong to a subject; deleting the subject keeps
-- the note, without subject.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 5000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_user_updated_idx on public.notes (user_id, pinned desc, updated_at desc);
create index notes_subject_idx on public.notes (subject_id);
alter table public.notes enable row level security;

revoke all on public.notes from anon, authenticated;
grant select, delete on public.notes to authenticated;
grant insert (subject_id, title, body, pinned), update (subject_id, title, body, pinned) on public.notes to authenticated;

create policy "own notes: read" on public.notes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own notes: add" on public.notes
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and (subject_id is null or exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid())))
  );
create policy "own notes: change" on public.notes
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (subject_id is null or exists (select 1 from public.subjects s where s.id = subject_id and s.user_id = (select auth.uid())))
  );
create policy "own notes: remove" on public.notes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- "Modifiée le …" follows edits of the content, not pinning.
create or replace function app_private.notes_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.title, new.body, new.subject_id) is distinct from (old.title, old.body, old.subject_id) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.notes_touch() from public, anon, authenticated;
create trigger notes_touch
  before update on public.notes
  for each row execute function app_private.notes_touch();

alter publication supabase_realtime add table public.notes;
