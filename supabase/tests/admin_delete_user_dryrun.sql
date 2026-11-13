-- Assertions for the admin_delete_user migration. The final RAISE always
-- aborts, so nothing is kept.
do $$
declare
  admin_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  cal uuid;
  secret_id uuid;
  n int;
begin
  insert into auth.users (id, email, aud, role) values
    (admin_id, 'admin@huecos.test', 'authenticated', 'authenticated'),
    (member_id, 'member@huecos.test', 'authenticated', 'authenticated'),
    (other_id, 'other@huecos.test', 'authenticated', 'authenticated');
  insert into app_private.admins (user_id) values (admin_id);
  insert into public.invitations (email) values ('member@huecos.test');

  -- The member has data, including a calendar with a Vault feed secret.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  insert into public.calendars (name, role) values ('Work', 'work') returning id into cal;
  insert into public.tasks (title) values ('Something');
  perform set_config('role', 'service_role', true);
  perform public.set_calendar_feed(cal, member_id, 'https://example.test/a.ics', 'example.test');
  select c.feed_secret_id into secret_id from public.calendars c where c.id = cal;

  -- Members can't delete accounts.
  perform set_config('role', 'authenticated', true);
  begin
    perform public.admin_delete_user(other_id);
    raise exception 'MEMBER_DELETED';
  exception when others then
    if sqlerrm = 'MEMBER_DELETED' then raise exception 'member could delete an account'; end if;
  end;

  -- Admins can't be deleted.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_delete_user(admin_id);
    raise exception 'ADMIN_DELETED';
  exception when others then
    if sqlerrm = 'ADMIN_DELETED' then raise exception 'an admin was deleted'; end if;
  end;

  -- The admin deletes the member: account, data, feed secret and invitation are gone.
  perform public.admin_delete_user(member_id);
  perform set_config('role', 'postgres', true);
  select count(*) into n from auth.users where id = member_id;
  if n <> 0 then raise exception 'account still there'; end if;
  select (select count(*) from public.calendars where user_id = member_id)
       + (select count(*) from public.tasks where user_id = member_id)
       + (select count(*) from public.settings where user_id = member_id) into n;
  if n <> 0 then raise exception '% rows of data left', n; end if;
  select count(*) into n from vault.secrets where id = secret_id;
  if n <> 0 then raise exception 'feed secret left in Vault'; end if;
  select count(*) into n from public.invitations where email = 'member@huecos.test';
  if n <> 0 then raise exception 'invitation left'; end if;
  select count(*) into n from auth.users where id = other_id;
  if n <> 1 then raise exception 'another account was deleted'; end if;

  raise exception 'ALL_OK';
end;
$$;
