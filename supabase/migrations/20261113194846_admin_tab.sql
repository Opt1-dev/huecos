-- Admin tab: single-use sign-up link, list of accounts, bans.

-- ---------------------------------------------------------------------------
-- Banned emails: no sign-up with them. Banning an account also adds its email.
-- ---------------------------------------------------------------------------
create table app_private.banned_emails (
  email text primary key check (email = lower(btrim(email)) and email like '%@%' and char_length(email) <= 320),
  banned_by uuid references auth.users (id) on delete set null,
  banned_at timestamptz not null default now()
);
alter table app_private.banned_emails enable row level security;
revoke all on app_private.banned_emails from public, anon, authenticated;
grant select on app_private.banned_emails to supabase_auth_admin;
create policy "auth hook reads banned emails" on app_private.banned_emails
  for select to supabase_auth_admin using (true);

-- Sign-up: refused for a banned email; otherwise allowed for an invited email
-- or with the current link's code.
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
  if candidate is not null and exists (select 1 from app_private.banned_emails b where b.email = candidate) then
    return jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'This email address is banned from Huecos.')
    );
  end if;
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
-- link used up (single use). If two people used the link at the same time,
-- only the first one gets an account.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_role text;
  given_code text := new.raw_user_meta_data ->> 'signup_code';
begin
  insert into public.settings (user_id) values (new.id) on conflict (user_id) do nothing;

  select i.role into invited_role from public.invitations i where i.email = lower(new.email);
  if invited_role = 'admin' then
    insert into app_private.admins (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;

  if given_code is not null then
    delete from app_private.signup_link l where l.code = given_code;
    if not found and invited_role is null then
      raise exception 'Huecos sign-up link already used' using errcode = 'P0001';
    end if;
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'signup_code' where id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin API. Every function checks the caller.
-- ---------------------------------------------------------------------------
create or replace function app_private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function app_private.require_admin() from public, anon;
grant execute on function app_private.require_admin() to authenticated;

-- Every account, newest first.
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  banned boolean,
  is_admin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin();
  return query
    select u.id,
           u.email::text,
           u.created_at,
           u.last_sign_in_at,
           coalesce(u.banned_until > now(), false)
             or exists (select 1 from app_private.banned_emails b where b.email = lower(u.email)),
           exists (select 1 from app_private.admins a where a.user_id = u.id)
    from auth.users u
    order by u.created_at desc;
end;
$$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- Ban an account: no more sign-in (open sessions are ended), and its email
-- can't sign up again. Its data is kept. Admins can't be banned.
create or replace function public.admin_ban_user(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_email text;
begin
  perform app_private.require_admin();
  if exists (select 1 from app_private.admins a where a.user_id = p_user_id) then
    raise exception 'an admin cannot be banned' using errcode = '42501';
  end if;
  update auth.users set banned_until = now() + interval '100 years'
  where id = p_user_id
  returning lower(email) into target_email;
  if not found then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  delete from auth.sessions s where s.user_id = p_user_id;
  if target_email is not null then
    insert into app_private.banned_emails (email, banned_by) values (target_email, (select auth.uid()))
    on conflict (email) do nothing;
  end if;
end;
$$;
revoke execute on function public.admin_ban_user(uuid) from public, anon;
grant execute on function public.admin_ban_user(uuid) to authenticated;

create or replace function public.admin_unban_user(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_email text;
begin
  perform app_private.require_admin();
  update auth.users set banned_until = null
  where id = p_user_id
  returning lower(email) into target_email;
  if not found then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  delete from app_private.banned_emails b where b.email = target_email;
end;
$$;
revoke execute on function public.admin_unban_user(uuid) from public, anon;
grant execute on function public.admin_unban_user(uuid) to authenticated;

-- Banned emails (including ones that never had an account).
create or replace function public.admin_list_banned_emails()
returns table (email text, banned_at timestamptz, has_account boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin();
  return query
    select b.email, b.banned_at, exists (select 1 from auth.users u where lower(u.email) = b.email)
    from app_private.banned_emails b
    order by b.banned_at desc;
end;
$$;
revoke execute on function public.admin_list_banned_emails() from public, anon;
grant execute on function public.admin_list_banned_emails() to authenticated;

-- Ban an email address; if it has an account, that account is banned too.
create or replace function public.admin_ban_email(p_email text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target text := lower(btrim(p_email));
  account uuid;
begin
  perform app_private.require_admin();
  if target is null or target not like '%@%' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  select u.id into account from auth.users u where lower(u.email) = target;
  if account is not null then
    perform public.admin_ban_user(account);
  else
    insert into app_private.banned_emails (email, banned_by) values (target, (select auth.uid()))
    on conflict (email) do nothing;
  end if;
end;
$$;
revoke execute on function public.admin_ban_email(text) from public, anon;
grant execute on function public.admin_ban_email(text) to authenticated;

create or replace function public.admin_unban_email(p_email text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target text := lower(btrim(p_email));
  account uuid;
begin
  perform app_private.require_admin();
  select u.id into account from auth.users u where lower(u.email) = target;
  if account is not null then
    perform public.admin_unban_user(account);
  else
    delete from app_private.banned_emails b where b.email = target;
  end if;
end;
$$;
revoke execute on function public.admin_unban_email(text) from public, anon;
grant execute on function public.admin_unban_email(text) to authenticated;
