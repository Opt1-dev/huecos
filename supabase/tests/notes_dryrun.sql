-- Assertions for the notes migration. The final RAISE always aborts, so
-- nothing is kept.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  subj uuid;
  note uuid;
  first_upd timestamptz;
  n int;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a@huecos.test', 'authenticated', 'authenticated'),
    (b, 'b@huecos.test', 'authenticated', 'authenticated');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.subjects (name) values ('The Buffer Club') returning id into subj;
  insert into public.notes (subject_id, title, body) values (subj, 'TBF identité', 'Couleurs, logo…') returning id into note;
  select updated_at into first_upd from public.notes where id = note;

  -- Pinning doesn't count as a modification; editing the text does.
  update public.notes set pinned = true where id = note;
  select count(*) into n from public.notes where id = note and pinned and updated_at = first_upd;
  if n <> 1 then raise exception 'pinning changed "modified on"'; end if;

  -- Limits.
  begin
    insert into public.notes (title, body) values ('Trop long', repeat('x', 5001));
    raise exception 'TOO_LONG';
  exception when others then
    if sqlerrm = 'TOO_LONG' then raise exception 'note over 5000 characters accepted'; end if;
  end;
  begin
    insert into public.notes (title) values ('   ');
    raise exception 'NO_TITLE';
  exception when others then
    if sqlerrm = 'NO_TITLE' then raise exception 'blank title accepted'; end if;
  end;

  -- B sees nothing of A and can't use A's subject.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.notes;
  if n <> 0 then raise exception 'B sees A''s notes'; end if;
  begin
    insert into public.notes (subject_id, title) values (subj, 'x');
    raise exception 'FOREIGN_SUBJECT';
  exception when others then
    if sqlerrm = 'FOREIGN_SUBJECT' then raise exception 'B used A''s subject'; end if;
  end;

  -- Deleting the subject keeps the note, without subject.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from public.subjects where id = subj;
  select count(*) into n from public.notes where id = note and subject_id is null;
  if n <> 1 then raise exception 'note lost or still linked after subject delete'; end if;

  raise exception 'ALL_OK';
end;
$$;
