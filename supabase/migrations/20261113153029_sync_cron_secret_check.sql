-- The pg_cron job sends the Vault secret huecos_sync_cron_secret in the
-- x-cron-secret header. sync-calendars checks it here instead of keeping a
-- copy in an Edge Function secret, so the value is generated inside the
-- database and never handled by a person:
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'huecos_sync_cron_secret');
create or replace function public.check_sync_cron_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(char_length(p_secret) >= 32, false)
    and exists (
      select 1
      from vault.decrypted_secrets s
      where s.name = 'huecos_sync_cron_secret' and s.decrypted_secret = p_secret
    );
$$;
revoke execute on function public.check_sync_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_sync_cron_secret(text) to service_role;
