-- Assertions for the rendus migration. The final RAISE always aborts, so
-- nothing is kept.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  cal uuid;
  ev1 uuid;
  ev2 uuid;
  subj uuid;
  r1 uuid;
  n int;
  st text;
  t text;
  d date;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a@huecos.test', 'authenticated', 'authenticated'),
    (b, 'b@huecos.test', 'authenticated', 'authenticated');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.calendars (name, role) values ('CESUR', 'school') returning id into cal;
  insert into public.subjects (name, color_index) values ('DEWES', 3) returning id into subj;
  begin
    insert into public.subjects (name) values ('  dewes ');
    raise exception 'DUP_SUBJECT';
  exception when others then
    if sqlerrm = 'DUP_SUBJECT' then raise exception 'duplicate subject name accepted'; end if;
  end;

  -- Two synced deadlines (written by the service role). 22:59 UTC = 23:59 in Madrid.
  perform set_config('role', 'service_role', true);
  insert into public.events (user_id, calendar_id, uid, title, start_at, end_at, event_type)
  values (a, cal, 'u1', 'Vencimiento de Tarea UT4', '2026-11-17T22:59:00Z', '2026-11-17T22:59:00Z', 'deadline')
  returning id into ev1;
  insert into public.events (user_id, calendar_id, uid, title, start_at, end_at, event_type)
  values (a, cal, 'u2', 'Vencimiento de Prueba Abierta UD02', '2026-11-20T22:59:00Z', '2026-11-20T22:59:00Z', 'deadline')
  returning id into ev2;

  -- A rendu linked to ev1: todo -> done marks the deadline done, back to todo unmarks it.
  perform set_config('role', 'authenticated', true);
  insert into public.rendus (event_id, subject_id, title, due, note) values (ev1, subj, 'Tarea UT4', '2026-11-17', 'Lire le sujet')
  returning id into r1;
  select count(*) into n from public.deadline_done where event_id = ev1;
  if n <> 0 then raise exception 'todo rendu marked its deadline done'; end if;
  update public.rendus set state = 'submitted' where id = r1;
  select count(*) into n from public.deadline_done where event_id = ev1;
  if n <> 1 then raise exception 'submitted rendu did not mark its deadline done'; end if;
  update public.rendus set state = 'graded', grade = 7.86 where id = r1;
  update public.rendus set state = 'todo', grade = null where id = r1;
  select count(*) into n from public.deadline_done where event_id = ev1;
  if n <> 0 then raise exception 'rendu back to todo kept its deadline done'; end if;

  -- Marking the deadline done moves the rendu to done; unmarking moves it back.
  insert into public.deadline_done (event_id) values (ev1);
  select state into st from public.rendus where id = r1;
  if st <> 'done' then raise exception 'done deadline left the rendu %', st; end if;
  delete from public.deadline_done where event_id = ev1;
  select state into st from public.rendus where id = r1;
  if st <> 'todo' then raise exception 'unmarked deadline left the rendu %', st; end if;

  -- A deadline marked done without a rendu creates one: prefix removed, local date.
  insert into public.deadline_done (event_id) values (ev2);
  select title, due, state into t, d, st from public.rendus where event_id = ev2;
  if t <> 'Prueba Abierta UD02' or d <> '2026-11-20' or st <> 'done' then
    raise exception 'rendu from deadline: % / % / %', t, d, st;
  end if;
  -- Deleting that rendu unmarks the deadline.
  delete from public.rendus where event_id = ev2;
  select count(*) into n from public.deadline_done where event_id = ev2;
  if n <> 0 then raise exception 'deleted rendu kept its deadline done'; end if;

  -- One rendu per event; grade between 0 and 10.
  begin
    insert into public.rendus (event_id, title, due) values (ev1, 'Again', '2026-11-17');
    raise exception 'TWO_RENDUS';
  exception when others then
    if sqlerrm = 'TWO_RENDUS' then raise exception 'two rendus for one event'; end if;
  end;
  begin
    update public.rendus set grade = 11 where id = r1;
    raise exception 'BAD_GRADE';
  exception when others then
    if sqlerrm = 'BAD_GRADE' then raise exception 'grade 11 accepted'; end if;
  end;

  -- A subject in use can't be deleted.
  begin
    delete from public.subjects where id = subj;
    raise exception 'SUBJECT_DELETED';
  exception when others then
    if sqlerrm = 'SUBJECT_DELETED' then raise exception 'subject in use deleted'; end if;
  end;

  -- B sees nothing of A and can't use A's event or subject.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select (select count(*) from public.rendus) + (select count(*) from public.subjects) into n;
  if n <> 0 then raise exception 'B sees % rows of A', n; end if;
  begin
    insert into public.rendus (event_id, title, due) values (ev2, 'x', '2026-11-20');
    raise exception 'FOREIGN_EVENT';
  exception when others then
    if sqlerrm = 'FOREIGN_EVENT' then raise exception 'B linked A''s event'; end if;
  end;
  begin
    insert into public.rendus (subject_id, title, due) values (subj, 'x', '2026-11-20');
    raise exception 'FOREIGN_SUBJECT';
  exception when others then
    if sqlerrm = 'FOREIGN_SUBJECT' then raise exception 'B used A''s subject'; end if;
  end;
  begin
    insert into public.deadline_done (event_id) values (ev2);
    raise exception 'FOREIGN_DONE';
  exception when others then
    if sqlerrm = 'FOREIGN_DONE' then raise exception 'B marked A''s deadline'; end if;
  end;

  -- When the event goes away the rendu stays, unlinked.
  perform set_config('role', 'service_role', true);
  delete from public.events where id = ev1;
  select count(*) into n from public.rendus where id = r1 and event_id is null;
  if n <> 1 then raise exception 'rendu lost with its event'; end if;

  raise exception 'ALL_OK';
end;
$$;
