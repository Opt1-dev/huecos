-- Phase 4 "Action requise": connected mailboxes (Microsoft first, Google
-- later), keywords, and the mails that contain one. Tokens live in Vault;
-- only an excerpt around the keyword is kept, never the whole mail.

-- ---------------------------------------------------------------------------
-- Mailboxes: written only by the Edge Functions (service role).
-- ---------------------------------------------------------------------------
create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('microsoft', 'google')),
  address text not null check (char_length(address) between 3 and 320),
  token_secret_id uuid,
  -- Mails received before this have been checked.
  checked_until timestamptz not null default now() - interval '7 days',
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create unique index mail_accounts_unique_idx on public.mail_accounts (user_id, provider, lower(address));
alter table public.mail_accounts enable row level security;

revoke all on public.mail_accounts from anon, authenticated;
-- Everything but the Vault reference.
grant select (id, user_id, provider, address, checked_until, last_checked_at, last_error, created_at) on public.mail_accounts to authenticated;
grant delete on public.mail_accounts to authenticated;
create policy "own mailboxes: read" on public.mail_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own mailboxes: disconnect" on public.mail_accounts
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Disconnecting removes the token from Vault.
create or replace function app_private.delete_mail_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.token_secret_id is not null then
    delete from vault.secrets where id = old.token_secret_id;
  end if;
  return old;
end;
$$;
revoke execute on function app_private.delete_mail_token() from public, anon, authenticated;
create trigger mail_accounts_delete_token
  after delete on public.mail_accounts
  for each row execute function app_private.delete_mail_token();

-- ---------------------------------------------------------------------------
-- Keywords: the user's own.
-- ---------------------------------------------------------------------------
create table public.mail_keywords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword text not null check (char_length(btrim(keyword)) between 2 and 100),
  -- Only mails whose sender (address or name) contains this.
  sender text check (sender is null or char_length(btrim(sender)) between 2 and 200),
  created_at timestamptz not null default now()
);
create unique index mail_keywords_unique_idx
  on public.mail_keywords (user_id, lower(btrim(keyword)), lower(btrim(coalesce(sender, ''))));
alter table public.mail_keywords enable row level security;

revoke all on public.mail_keywords from anon, authenticated;
grant select, delete on public.mail_keywords to authenticated;
grant insert (keyword, sender) on public.mail_keywords to authenticated;
create policy "own keywords: read" on public.mail_keywords
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own keywords: add" on public.mail_keywords
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own keywords: remove" on public.mail_keywords
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Mails that contain a keyword: written by check-mail, marked done by the user.
-- ---------------------------------------------------------------------------
create table public.mail_hits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.mail_accounts (id) on delete cascade,
  message_id text not null check (char_length(message_id) <= 1000),
  subject text not null default '' check (char_length(subject) <= 500),
  sender_name text not null default '' check (char_length(sender_name) <= 200),
  sender_address text not null default '' check (char_length(sender_address) <= 320),
  received_at timestamptz not null,
  snippet text not null default '' check (char_length(snippet) <= 400),
  keywords text[] not null default '{}',
  web_link text check (web_link is null or web_link ~ '^https://'),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, message_id)
);
create index mail_hits_user_idx on public.mail_hits (user_id, done, received_at desc);
alter table public.mail_hits enable row level security;

revoke all on public.mail_hits from anon, authenticated;
grant select, delete on public.mail_hits to authenticated;
grant update (done) on public.mail_hits to authenticated;
create policy "own mail hits: read" on public.mail_hits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own mail hits: mark" on public.mail_hits
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own mail hits: remove" on public.mail_hits
  for delete to authenticated using ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.mail_hits;

-- ---------------------------------------------------------------------------
-- OAuth: short-lived "state" for the sign-in round trip (not exposed).
-- ---------------------------------------------------------------------------
create table app_private.oauth_states (
  state text primary key check (char_length(state) >= 32),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('microsoft', 'google')),
  code_verifier text not null,
  return_to text not null,
  created_at timestamptz not null default now()
);
alter table app_private.oauth_states enable row level security;
revoke all on app_private.oauth_states from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Service-only functions used by the Edge Functions.
-- ---------------------------------------------------------------------------
create or replace function public.mail_oauth_begin(p_user_id uuid, p_provider text, p_code_verifier text, p_return_to text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  fresh text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from app_private.oauth_states where created_at < now() - interval '15 minutes';
  insert into app_private.oauth_states (state, user_id, provider, code_verifier, return_to)
  values (fresh, p_user_id, p_provider, p_code_verifier, p_return_to);
  return fresh;
end;
$$;

-- Takes the state (single use, 10 minutes at most).
create or replace function public.mail_oauth_take(p_state text)
returns table (user_id uuid, provider text, code_verifier text, return_to text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
    with taken as (
      delete from app_private.oauth_states s
      where s.state = p_state and s.created_at > now() - interval '10 minutes'
      returning s.user_id, s.provider, s.code_verifier, s.return_to
    )
    select t.user_id, t.provider, t.code_verifier, t.return_to from taken t;
end;
$$;

-- Creates or reconnects a mailbox and stores its refresh token in Vault.
create or replace function public.mail_account_save(p_user_id uuid, p_provider text, p_address text, p_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  acc public.mail_accounts%rowtype;
begin
  select * into acc from public.mail_accounts a
  where a.user_id = p_user_id and a.provider = p_provider and lower(a.address) = lower(p_address)
  for update;
  if not found then
    insert into public.mail_accounts (user_id, provider, address)
    values (p_user_id, p_provider, p_address)
    returning * into acc;
  end if;
  if acc.token_secret_id is null then
    update public.mail_accounts
    set token_secret_id = vault.create_secret(p_token, 'mail_token_' || acc.id::text, 'Huecos mailbox token'),
        last_error = null
    where id = acc.id;
  else
    perform vault.update_secret(acc.token_secret_id, p_token);
    update public.mail_accounts set last_error = null where id = acc.id;
  end if;
  return acc.id;
end;
$$;

-- Replaces a refresh token after a refresh (providers may rotate it).
create or replace function public.mail_token_update(p_account_id uuid, p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  secret uuid;
begin
  select a.token_secret_id into secret from public.mail_accounts a where a.id = p_account_id;
  if secret is not null then
    perform vault.update_secret(secret, p_token);
  end if;
end;
$$;

-- Mailboxes to check, with their decrypted token, optionally for one user.
create or replace function public.mail_accounts_for_check(p_user_id uuid default null)
returns table (account_id uuid, user_id uuid, provider text, address text, token text, checked_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.user_id, a.provider, a.address, s.decrypted_secret, a.checked_until
  from public.mail_accounts a
  join vault.decrypted_secrets s on s.id = a.token_secret_id
  where p_user_id is null or a.user_id = p_user_id;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.mail_oauth_begin(uuid, text, text, text)',
    'public.mail_oauth_take(text)',
    'public.mail_account_save(uuid, text, text, text)',
    'public.mail_token_update(uuid, text)',
    'public.mail_accounts_for_check(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Every 15 minutes, check every mailbox (same Vault secret as the calendar sync).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'huecos-check-mail',
  '7,22,37,52 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'huecos_project_url')
      || '/functions/v1/check-mail',
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
