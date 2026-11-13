-- Permanent sign-up link: https://…/huecos/?join=<code>. Anyone with the link
-- can create an account (email + password). Admins can read, replace (the old
-- link stops working) or disable it. The invitations list keeps working too.

-- At most one active code (no row = link disabled). Not exposed by the API.
create table app_private.signup_link (
  id boolean primary key default true check (id),
  code text not null check (char_length(code) between 24 and 64),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table app_private.signup_link enable row level security;
revoke all on app_private.signup_link from public, anon, authenticated;
grant select on app_private.signup_link to supabase_auth_admin;
-- The Auth hook reads it as supabase_auth_admin.
create policy "auth hook reads the code" on app_private.signup_link
  for select to supabase_auth_admin using (true);

-- Sign-up allowed for an invited email, or with the current link's code
-- (sent by the app as user_metadata.signup_code).
create or replace function app_private.before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  candidate text := lower(btrim(event -> 'user' ->> 'email'));
  given_code text := event -> 'user' -> 'user_metadata' ->> 'signup_code';
begin
  if candidate is not null and exists (
    select 1 from public.invitations i where i.email = candidate
  ) then
    return '{}'::jsonb;
  end if;
  if given_code is not null and char_length(given_code) >= 24 and exists (
    select 1 from app_private.signup_link l where l.code = given_code
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

-- New account: settings row, admin role from an invitation, and the sign-up
-- code removed from the user's metadata.
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

  if new.raw_user_meta_data ? 'signup_code' then
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'signup_code' where id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- API for the app. Every function checks the caller.
-- ---------------------------------------------------------------------------
create or replace function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_admin();
$$;
revoke execute on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

create or replace function public.get_signup_code()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return (select l.code from app_private.signup_link l);
end;
$$;
revoke execute on function public.get_signup_code() from public, anon;
grant execute on function public.get_signup_code() to authenticated;

create or replace function public.rotate_signup_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  fresh text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  if not app_private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  insert into app_private.signup_link (id, code, created_by, created_at)
  values (true, fresh, (select auth.uid()), now())
  on conflict (id) do update set code = excluded.code, created_by = excluded.created_by, created_at = excluded.created_at;
  return fresh;
end;
$$;
revoke execute on function public.rotate_signup_code() from public, anon;
grant execute on function public.rotate_signup_code() to authenticated;

create or replace function public.disable_signup_code()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app_private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  delete from app_private.signup_link;
end;
$$;
revoke execute on function public.disable_signup_code() from public, anon;
grant execute on function public.disable_signup_code() to authenticated;
