-- Assertions for the day_planning migration. The final RAISE always aborts,
-- so nothing is kept.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  cal uuid;
  ev uuid;
  secret_id uuid;
  n int;
  feed text;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a@huecos.test', 'authenticated', 'authenticated'),
    (b, 'b@huecos.test', 'authenticated', 'authenticated');

  -- Prácticas defaults on the auto-created settings row.
  select count(*) into n from public.settings
  where user_id = a and practicas_start_min = 540 and practicas_end_min = 780
    and practicas_buffer_before_min = 45 and practicas_buffer_after_min = 75 and practicas_total_hours = 500;
  if n <> 1 then raise exception 'prácticas defaults missing'; end if;

  -- User A creates a calendar.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.calendars (name, role, color, buffer_before_min) values ('Amorino', 'work', '#e3a008', 75)
  returning id into cal;

  begin
    update public.calendars set feed_secret_id = gen_random_uuid() where id = cal;
    raise exception 'FEED_WRITABLE';
  exception when others then
    if sqlerrm = 'FEED_WRITABLE' then raise exception 'browser could set feed_secret_id'; end if;
  end;
  begin
    perform public.set_calendar_feed(cal, a, 'https://example.test/a.ics', 'example.test');
    raise exception 'RPC_ALLOWED';
  exception when others then
    if sqlerrm = 'RPC_ALLOWED' then raise exception 'authenticated could call set_calendar_feed'; end if;
  end;
  begin
    perform * from public.calendar_feeds_for_sync(null);
    raise exception 'FEEDS_READABLE';
  exception when others then
    if sqlerrm = 'FEEDS_READABLE' then raise exception 'authenticated could read feed URLs'; end if;
  end;

  -- User B sees nothing of A.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.calendars;
  if n <> 0 then raise exception 'B sees % calendars of A', n; end if;

  -- Service role stores the feed in Vault and reads it back for sync.
  perform set_config('role', 'service_role', true);
  perform public.set_calendar_feed(cal, a, 'https://example.test/a.ics', 'example.test');
  select f.url into feed from public.calendar_feeds_for_sync(a) f where f.calendar_id = cal;
  if feed is distinct from 'https://example.test/a.ics' then raise exception 'feed not stored: %', feed; end if;
  begin
    perform public.set_calendar_feed(cal, b, 'https://evil.test/x.ics', 'evil.test');
    raise exception 'WRONG_OWNER_ALLOWED';
  exception when others then
    if sqlerrm = 'WRONG_OWNER_ALLOWED' then raise exception 'feed set for another user''s calendar'; end if;
  end;

  -- Sync writes an event (as the table owner, like the service role).
  perform set_config('role', 'postgres', true);
  insert into public.events (user_id, calendar_id, uid, title, start_at, end_at)
  values (a, cal, 'shift-1', 'Amorino', '2026-11-20 17:00+00', '2026-11-21 00:00+00')
  returning id into ev;

  -- B cannot override A's event; A can.
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.overrides (event_id, cancelled) values (ev, true);
    raise exception 'FOREIGN_OVERRIDE';
  exception when others then
    if sqlerrm = 'FOREIGN_OVERRIDE' then raise exception 'B overrode A''s event'; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.overrides (event_id, start_at, end_at) values (ev, '2026-11-20 18:00+00', '2026-11-21 01:00+00');
  insert into public.tasks (title, quadrant, day, start_min, duration_min) values ('Réviser', 1, '2026-11-20', 600, 60);
  insert into public.blocked_days (date, kind) values ('2026-12-08', 'holiday');
  select count(*) into n from public.events;
  if n <> 1 then raise exception 'A sees % events', n; end if;
  begin
    insert into public.events (user_id, calendar_id, uid, start_at, end_at) values (a, cal, 'x', now(), now());
    raise exception 'EVENT_WRITABLE';
  exception when others then
    if sqlerrm = 'EVENT_WRITABLE' then raise exception 'browser could write events'; end if;
  end;

  -- Deleting the calendar removes its events, overrides and Vault secret.
  perform set_config('role', 'postgres', true);
  select feed_secret_id into secret_id from public.calendars where id = cal;
  perform set_config('role', 'authenticated', true);
  delete from public.calendars where id = cal;
  perform set_config('role', 'postgres', true);
  select count(*) into n from vault.secrets s where s.id = secret_id;
  if n <> 0 then raise exception 'Vault secret left behind'; end if;
  select count(*) into n from public.overrides where user_id = a;
  if n <> 0 then raise exception 'override left behind'; end if;

  -- Cron job registered.
  select count(*) into n from cron.job where jobname = 'huecos-sync-calendars';
  if n <> 1 then raise exception 'cron job missing'; end if;

  raise exception 'ALL_OK';
end;
$$;
