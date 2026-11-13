-- Assertions for the admin_tab migration. The final RAISE always aborts,
-- so nothing is kept.
do $$
declare
  admin_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  code text;
  result jsonb;
  n int;
  flag boolean;
begin
  insert into auth.users (id, email, aud, role) values
    (admin_id, 'admin@huecos.test', 'authenticated', 'authenticated'),
    (member_id, 'Member@Huecos.test', 'authenticated', 'authenticated');
  insert into app_private.admins (user_id) values (admin_id);
  insert into public.invitations (email) values ('member@huecos.test');

  -- Members can't use the admin API.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  begin
    perform * from public.admin_list_users();
    raise exception 'MEMBER_LIST';
  exception when others then
    if sqlerrm = 'MEMBER_LIST' then raise exception 'member could list accounts'; end if;
  end;
  begin
    perform public.admin_ban_user(admin_id);
    raise exception 'MEMBER_BAN';
  exception when others then
    if sqlerrm = 'MEMBER_BAN' then raise exception 'member could ban'; end if;
  end;

  -- The admin sees both accounts.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.admin_list_users() u where u.id in (admin_id, member_id);
  if n <> 2 then raise exception 'admin sees % of 2 accounts', n; end if;
  select u.is_admin into flag from public.admin_list_users() u where u.id = admin_id;
  if not flag then raise exception 'admin flag missing'; end if;

  -- An admin can't be banned.
  begin
    perform public.admin_ban_user(admin_id);
    raise exception 'ADMIN_BANNED';
  exception when others then
    if sqlerrm = 'ADMIN_BANNED' then raise exception 'an admin was banned'; end if;
  end;

  -- Ban the member: account blocked, email refused at sign-up even though invited.
  perform public.admin_ban_user(member_id);
  select u.banned into flag from public.admin_list_users() u where u.id = member_id;
  if not flag then raise exception 'member not shown as banned'; end if;
  perform set_config('role', 'postgres', true);
  select count(*) into n from auth.users where id = member_id and banned_until > now() + interval '50 years';
  if n <> 1 then raise exception 'banned_until not set'; end if;
  result := app_private.before_user_created('{"user":{"email":"MEMBER@huecos.test"}}');
  if result -> 'error' ->> 'message' not like '%banned%' then raise exception 'banned email accepted: %', result; end if;

  -- Unban: invited again, so sign-up is allowed.
  perform set_config('role', 'authenticated', true);
  perform public.admin_unban_user(member_id);
  perform set_config('role', 'postgres', true);
  result := app_private.before_user_created('{"user":{"email":"member@huecos.test"}}');
  if result <> '{}'::jsonb then raise exception 'unbanned email refused: %', result; end if;
  select count(*) into n from auth.users where id = member_id and banned_until is null;
  if n <> 1 then raise exception 'banned_until not cleared'; end if;

  -- Ban an email that has no account.
  perform set_config('role', 'authenticated', true);
  perform public.admin_ban_email('  Stranger@Huecos.test ');
  select count(*) into n from public.admin_list_banned_emails() b where b.email = 'stranger@huecos.test' and not b.has_account;
  if n <> 1 then raise exception 'email ban not listed'; end if;
  perform set_config('role', 'postgres', true);
  result := app_private.before_user_created('{"user":{"email":"stranger@huecos.test"}}');
  if result -> 'error' ->> 'message' not like '%banned%' then raise exception 'banned stranger accepted'; end if;
  perform set_config('role', 'authenticated', true);
  perform public.admin_unban_email('stranger@huecos.test');
  select count(*) into n from public.admin_list_banned_emails();
  if n <> 0 then raise exception 'email not unbanned'; end if;

  -- Single-use link: the first sign-up uses it up, a second one fails.
  code := public.rotate_signup_code();
  perform set_config('role', 'postgres', true);
  insert into auth.users (id, email, aud, role, raw_user_meta_data)
  values (first_id, 'first@huecos.test', 'authenticated', 'authenticated', jsonb_build_object('signup_code', code));
  select count(*) into n from app_private.signup_link;
  if n <> 0 then raise exception 'link not used up'; end if;
  result := app_private.before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'second@huecos.test', 'user_metadata', jsonb_build_object('signup_code', code))));
  if result -> 'error' ->> 'http_code' <> '403' then raise exception 'used link accepted by the hook'; end if;
  begin
    insert into auth.users (id, email, aud, role, raw_user_meta_data)
    values (gen_random_uuid(), 'second@huecos.test', 'authenticated', 'authenticated', jsonb_build_object('signup_code', code));
    raise exception 'SECOND_SIGNUP';
  exception when others then
    if sqlerrm = 'SECOND_SIGNUP' then raise exception 'used link created a second account'; end if;
  end;

  raise exception 'ALL_OK';
end;
$$;
