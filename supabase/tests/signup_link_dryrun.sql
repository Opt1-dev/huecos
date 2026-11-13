-- Assertions for the signup_link migration. The final RAISE always aborts,
-- so nothing is kept.
do $$
declare
  admin_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  joined uuid := gen_random_uuid();
  code text;
  result jsonb;
  n int;
  meta jsonb;
  ev jsonb;
begin
  insert into auth.users (id, email, aud, role) values
    (admin_id, 'admin@huecos.test', 'authenticated', 'authenticated'),
    (member_id, 'member@huecos.test', 'authenticated', 'authenticated');
  insert into app_private.admins (user_id) values (admin_id);

  -- Members can't read or change the link.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  if public.am_i_admin() then raise exception 'member seen as admin'; end if;
  begin
    perform public.rotate_signup_code();
    raise exception 'MEMBER_ROTATED';
  exception when others then
    if sqlerrm = 'MEMBER_ROTATED' then raise exception 'member could create a link'; end if;
  end;
  begin
    perform public.get_signup_code();
    raise exception 'MEMBER_READ';
  exception when others then
    if sqlerrm = 'MEMBER_READ' then raise exception 'member could read the link'; end if;
  end;
  begin
    perform * from app_private.signup_link;
    raise exception 'TABLE_READ';
  exception when others then
    if sqlerrm = 'TABLE_READ' then raise exception 'authenticated could read app_private.signup_link'; end if;
  end;

  -- The admin creates the link.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if not public.am_i_admin() then raise exception 'admin not seen as admin'; end if;
  if public.get_signup_code() is not null then raise exception 'link active by default'; end if;
  code := public.rotate_signup_code();
  if char_length(code) <> 36 or public.get_signup_code() <> code then raise exception 'link not created: %', code; end if;

  -- The Auth hook runs as supabase_auth_admin: it must be able to read the code.
  if not has_table_privilege('supabase_auth_admin', 'app_private.signup_link', 'SELECT') then
    raise exception 'auth hook cannot read the link';
  end if;
  if has_table_privilege('authenticated', 'app_private.signup_link', 'SELECT') then
    raise exception 'authenticated can read the link table';
  end if;
  perform set_config('role', 'postgres', true);
  ev := jsonb_build_object('user', jsonb_build_object('email', 'new@huecos.test', 'user_metadata', jsonb_build_object('signup_code', code)));
  result := app_private.before_user_created(ev);
  if result <> '{}'::jsonb then raise exception 'right code refused: %', result; end if;
  result := app_private.before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'new@huecos.test', 'user_metadata', jsonb_build_object('signup_code', repeat('0', 36)))));
  if result -> 'error' ->> 'http_code' <> '403' then raise exception 'wrong code accepted'; end if;
  result := app_private.before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'new@huecos.test', 'user_metadata', '{}'::jsonb)));
  if result -> 'error' ->> 'http_code' <> '403' then raise exception 'no code accepted'; end if;

  -- A new link replaces the old one; disabling removes it.
  perform set_config('role', 'authenticated', true);
  perform public.rotate_signup_code();
  perform set_config('role', 'postgres', true);
  result := app_private.before_user_created(ev);
  if result -> 'error' ->> 'http_code' <> '403' then raise exception 'old code still accepted'; end if;
  perform set_config('role', 'authenticated', true);
  perform public.disable_signup_code();
  if public.get_signup_code() is not null then raise exception 'link not disabled'; end if;

  -- The sign-up code is removed from the new user's metadata.
  perform set_config('role', 'postgres', true);
  insert into auth.users (id, email, aud, role, raw_user_meta_data)
  values (joined, 'joined@huecos.test', 'authenticated', 'authenticated', jsonb_build_object('signup_code', code, 'x', 1));
  select raw_user_meta_data into meta from auth.users where id = joined;
  if meta ? 'signup_code' or meta ->> 'x' <> '1' then raise exception 'metadata not cleaned: %', meta; end if;
  select count(*) into n from public.settings where user_id = joined;
  if n <> 1 then raise exception 'settings row missing'; end if;

  raise exception 'ALL_OK';
end;
$$;
