-- Cron secret check: only the service role may call it, and only the Vault value matches.
do $$
declare
  ok boolean;
begin
  perform vault.create_secret(repeat('a', 64), 'huecos_sync_cron_secret');
  perform set_config('role', 'authenticated', true);
  begin
    perform public.check_sync_cron_secret(repeat('a', 64));
    raise exception 'CHECK_CALLABLE';
  exception when others then
    if sqlerrm = 'CHECK_CALLABLE' then raise exception 'authenticated could call check_sync_cron_secret'; end if;
  end;
  perform set_config('role', 'service_role', true);
  if not public.check_sync_cron_secret(repeat('a', 64)) then raise exception 'right secret refused'; end if;
  if public.check_sync_cron_secret(repeat('b', 64)) then raise exception 'wrong secret accepted'; end if;
  if public.check_sync_cron_secret('') or public.check_sync_cron_secret(null) then raise exception 'empty secret accepted'; end if;
  raise exception 'ALL_OK';
end;
$$;
