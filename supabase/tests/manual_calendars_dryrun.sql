-- Assertions for the manual_calendars migration. The final RAISE always aborts,
-- so nothing is kept.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  manual_cal uuid;
  feed_cal uuid;
  entry uuid;
  n int;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a@huecos.test', 'authenticated', 'authenticated'),
    (b, 'b@huecos.test', 'authenticated', 'authenticated');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.calendars (name, role, source) values ('Gym', 'gym', 'manual') returning id into manual_cal;
  insert into public.calendars (name, role) values ('Work', 'work') returning id into feed_cal;

  select count(*) into n from public.calendars where id = feed_cal and source = 'feed';
  if n <> 1 then raise exception 'source does not default to feed'; end if;

  -- A repeating entry in a manual calendar.
  insert into public.calendar_entries (calendar_id, title, start_min, end_min, weekdays, start_date)
  values (manual_cal, 'Gym', 1140, 1230, '{1,3,5}', '2026-11-16') returning id into entry;
  update public.calendar_entries set weekdays = '{1,2,3,4,5,6,7}' where id = entry;

  -- Not into a feed calendar.
  begin
    insert into public.calendar_entries (calendar_id, title, start_min, end_min, weekdays, start_date)
    values (feed_cal, 'x', 600, 660, '{1}', '2026-11-16');
    raise exception 'FEED_ENTRY';
  exception when others then
    if sqlerrm = 'FEED_ENTRY' then raise exception 'entry accepted in a feed calendar'; end if;
  end;
  -- No invalid weekday, empty weekday list, or end before start.
  begin
    insert into public.calendar_entries (calendar_id, title, start_min, end_min, weekdays, start_date)
    values (manual_cal, 'x', 600, 660, '{0,8}', '2026-11-16');
    raise exception 'BAD_DAYS';
  exception when others then
    if sqlerrm = 'BAD_DAYS' then raise exception 'weekday outside 1..7 accepted'; end if;
  end;
  begin
    insert into public.calendar_entries (calendar_id, title, start_min, end_min, weekdays, start_date)
    values (manual_cal, 'x', 600, 660, '{}', '2026-11-16');
    raise exception 'NO_DAYS';
  exception when others then
    if sqlerrm = 'NO_DAYS' then raise exception 'empty weekday list accepted'; end if;
  end;
  begin
    insert into public.calendar_entries (calendar_id, title, start_min, end_min, weekdays, start_date)
    values (manual_cal, 'x', 660, 600, '{1}', '2026-11-16');
    raise exception 'BACKWARDS';
  exception when others then
    if sqlerrm = 'BACKWARDS' then raise exception 'end before start accepted'; end if;
  end;
  -- The calendar of an entry and the source of a calendar cannot be changed.
  begin
    update public.calendar_entries set calendar_id = feed_cal where id = entry;
    raise exception 'MOVED';
  exception when others then
    if sqlerrm = 'MOVED' then raise exception 'entry moved to another calendar'; end if;
  end;
  begin
    update public.calendars set source = 'feed' where id = manual_cal;
    raise exception 'SOURCE_CHANGED';
  exception when others then
    if sqlerrm = 'SOURCE_CHANGED' then raise exception 'calendar source changed'; end if;
  end;

  -- B sees nothing of A and cannot add into A's calendar.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.calendar_entries;
  if n <> 0 then raise exception 'B sees % entries of A', n; end if;
  begin
    insert into public.calendar_entries (calendar_id, title, start_min, end_min, weekdays, start_date)
    values (manual_cal, 'x', 600, 660, '{1}', '2026-11-16');
    raise exception 'FOREIGN_ENTRY';
  exception when others then
    if sqlerrm = 'FOREIGN_ENTRY' then raise exception 'B added an entry to A''s calendar'; end if;
  end;
  update public.calendar_entries set title = 'hacked' where id = entry;
  delete from public.calendar_entries where id = entry;

  -- A manual calendar never gets a feed, even through the service function.
  perform set_config('role', 'service_role', true);
  begin
    perform public.set_calendar_feed(manual_cal, a, 'https://example.test/a.ics', 'example.test');
    raise exception 'MANUAL_FEED';
  exception when others then
    if sqlerrm = 'MANUAL_FEED' then raise exception 'feed stored on a manual calendar'; end if;
  end;
  select count(*) into n from public.calendar_entries where id = entry and title = 'Gym';
  if n <> 1 then raise exception 'B changed or deleted A''s entry'; end if;

  -- Deleting the calendar deletes its entries.
  delete from public.calendars where id = manual_cal;
  select count(*) into n from public.calendar_entries where id = entry;
  if n <> 0 then raise exception 'entries kept after calendar delete'; end if;

  raise exception 'ALL_OK';
end;
$$;
