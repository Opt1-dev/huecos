-- Assertions for the deadline_work migration. The final RAISE always aborts,
-- so nothing is kept.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  cal uuid;
  ev uuid;
  n int;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a@huecos.test', 'authenticated', 'authenticated'),
    (b, 'b@huecos.test', 'authenticated', 'authenticated');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.calendars (name, role) values ('CESUR', 'school') returning id into cal;

  select count(*) into n from public.calendars where id = cal and deadline_work_min = 0 and deadline_daily_max_min = 120;
  if n <> 1 then raise exception 'wrong defaults'; end if;
  update public.calendars set deadline_work_min = 360, deadline_daily_max_min = 180 where id = cal;
  begin
    update public.calendars set deadline_daily_max_min = 5 where id = cal;
    raise exception 'TOO_SMALL';
  exception when others then
    if sqlerrm = 'TOO_SMALL' then raise exception 'daily max under 15 min accepted'; end if;
  end;

  -- A synced deadline (written by the service role).
  perform set_config('role', 'service_role', true);
  insert into public.events (user_id, calendar_id, uid, title, start_at, end_at, event_type)
  values (a, cal, 'u1', 'Vencimiento de Tarea', '2026-11-17T22:59:00Z', '2026-11-17T22:59:00Z', 'deadline')
  returning id into ev;

  perform set_config('role', 'authenticated', true);
  insert into public.deadline_done (event_id) values (ev);
  select count(*) into n from public.deadline_done where event_id = ev and user_id = a;
  if n <> 1 then raise exception 'owner could not mark done'; end if;

  -- B can neither see nor mark A's deadline.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.deadline_done;
  if n <> 0 then raise exception 'B sees A''s done deadlines'; end if;
  delete from public.deadline_done where event_id = ev;
  begin
    insert into public.deadline_done (event_id) values (ev);
    raise exception 'FOREIGN_DONE';
  exception when others then
    if sqlerrm = 'FOREIGN_DONE' then raise exception 'B marked A''s deadline done'; end if;
  end;

  -- Deleting the event removes the mark.
  perform set_config('role', 'service_role', true);
  select count(*) into n from public.deadline_done where event_id = ev;
  if n <> 1 then raise exception 'B removed A''s mark'; end if;
  delete from public.events where id = ev;
  select count(*) into n from public.deadline_done where event_id = ev;
  if n <> 0 then raise exception 'mark kept after event delete'; end if;

  raise exception 'ALL_OK';
end;
$$;
