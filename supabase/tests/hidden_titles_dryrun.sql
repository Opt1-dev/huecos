-- Assertions for the calendar_hidden_titles migration. The final RAISE always
-- aborts, so nothing is kept.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  cal uuid;
  n int;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a@huecos.test', 'authenticated', 'authenticated'),
    (b, 'b@huecos.test', 'authenticated', 'authenticated');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.calendars (name, role) values ('Amorino', 'work') returning id into cal;

  select count(*) into n from public.calendars where id = cal and hidden_titles = '{}';
  if n <> 1 then raise exception 'hidden_titles does not default to empty'; end if;

  update public.calendars set hidden_titles = '{"Día libre","Vacaciones"}' where id = cal;
  select count(*) into n from public.calendars where id = cal and cardinality(hidden_titles) = 2;
  if n <> 1 then raise exception 'owner could not hide titles'; end if;

  begin
    update public.calendars set hidden_titles = array(select 'x' || g from generate_series(1, 101) g) where id = cal;
    raise exception 'TOO_MANY';
  exception when others then
    if sqlerrm = 'TOO_MANY' then raise exception 'more than 100 hidden titles accepted'; end if;
  end;

  -- B cannot change A's calendar.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  update public.calendars set hidden_titles = '{}' where id = cal;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into n from public.calendars where id = cal and cardinality(hidden_titles) = 2;
  if n <> 1 then raise exception 'B changed A''s hidden titles'; end if;

  raise exception 'ALL_OK';
end;
$$;
