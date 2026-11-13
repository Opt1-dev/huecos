-- Huecos foundation: invite-only sign-up, admins, per-user settings.
-- Feature tables (calendars, events, tasks, ...) come in later migrations.

-- ---------------------------------------------------------------------------
-- Private schema: not exposed through the Data API, holds helpers and hooks.
-- ---------------------------------------------------------------------------
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, supabase_auth_admin;

-- Shared trigger: keep updated_at current.
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admins: who may manage invitations. Rows are added only by SQL / triggers.
-- ---------------------------------------------------------------------------
create table app_private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on app_private.admins from public, anon, authenticated;

-- Used inside RLS policies. SECURITY DEFINER so it can read app_private.admins,
-- which authenticated cannot read directly; it only reveals the caller's own status.
create or replace function app_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app_private.admins a where a.user_id = (select auth.uid())
  );
$$;
revoke execute on function app_private.is_admin() from public, anon;
grant execute on function app_private.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Invitations: the allowlist checked before any account is created.
-- ---------------------------------------------------------------------------
create table public.invitations (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  role text not null default 'member' check (role in ('member', 'admin')),
  invited_by uuid references auth.users (id) on delete set null default auth.uid(),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index invitations_invited_by_idx on public.invitations (invited_by);
alter table public.invitations enable row level security;

revoke all on public.invitations from anon;
grant select, insert, update, delete on public.invitations to authenticated;
grant select on public.invitations to supabase_auth_admin;

create policy "admins read invitations" on public.invitations
  for select to authenticated using ((select app_private.is_admin()));
create policy "admins add invitations" on public.invitations
  for insert to authenticated with check ((select app_private.is_admin()));
create policy "admins change invitations" on public.invitations
  for update to authenticated
  using ((select app_private.is_admin()))
  with check ((select app_private.is_admin()));
create policy "admins remove invitations" on public.invitations
  for delete to authenticated using ((select app_private.is_admin()));
create policy "auth server reads invitations" on public.invitations
  for select to supabase_auth_admin using (true);

-- Auth hook "before user created": reject any email that is not invited.
-- Enable it in Dashboard > Authentication > Hooks (see README).
create or replace function app_private.before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  candidate text := lower(btrim(event -> 'user' ->> 'email'));
begin
  if candidate is not null and exists (
    select 1 from public.invitations i where i.email = candidate
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Huecos is invite-only. Ask the owner for an invitation.'
    )
  );
end;
$$;
revoke execute on function app_private.before_user_created(jsonb) from public, anon, authenticated;
grant execute on function app_private.before_user_created(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Settings: one row per user, created automatically at sign-up.
-- ---------------------------------------------------------------------------
create table public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  display_name text check (char_length(display_name) <= 80),
  locale text not null default 'fr' check (locale in ('fr', 'es', 'en')),
  timezone text not null default 'Europe/Madrid' check (char_length(timezone) <= 64),
  -- Free time is only counted inside [day_start_min, day_end_min) minutes since midnight.
  day_start_min smallint not null default 480 check (day_start_min between 0 and 1439),
  day_end_min smallint not null default 1440 check (day_end_min between 1 and 1440),
  min_slot_min smallint not null default 15 check (min_slot_min between 5 and 240),
  -- Optional modules.
  module_etudes boolean not null default false,
  module_outlook boolean not null default false,
  module_practicas boolean not null default false,
  mail_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (day_start_min < day_end_min)
);
alter table public.settings enable row level security;

revoke all on public.settings from anon;
grant select, update on public.settings to authenticated;

create policy "users read own settings" on public.settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "users update own settings" on public.settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function app_private.set_updated_at();

-- New account: create its settings row and grant admin if the invitation says so.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_role text;
begin
  insert into public.settings (user_id) values (new.id) on conflict (user_id) do nothing;

  select i.role into invited_role from public.invitations i where i.email = lower(new.email);
  if invited_role = 'admin' then
    insert into app_private.admins (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();
