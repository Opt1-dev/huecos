-- Assertions for the foundation migration. Run after the migration inside one
-- transaction; the final RAISE always aborts so nothing is kept.
do $$
declare
  admin_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  r jsonb;
  n int;
begin
  insert into public.invitations (email, role) values ('owner@huecos.test', 'admin'), ('friend@huecos.test', 'member');

  -- Hook: invited allowed (case-insensitive), others rejected.
  r := app_private.before_user_created('{"user":{"email":"Owner@Huecos.test"}}');
  if r <> '{}'::jsonb then raise exception 'hook rejected invited email: %', r; end if;
  r := app_private.before_user_created('{"user":{"email":"stranger@huecos.test"}}');
  if (r -> 'error' ->> 'http_code') is distinct from '403' then raise exception 'hook allowed stranger: %', r; end if;

  -- Sign-up trigger: settings row for each, admin only for the admin invite.
  insert into auth.users (id, email, aud, role) values (admin_id, 'owner@huecos.test', 'authenticated', 'authenticated');
  insert into auth.users (id, email, aud, role) values (member_id, 'friend@huecos.test', 'authenticated', 'authenticated');
  select count(*) into n from public.settings where user_id in (admin_id, member_id);
  if n <> 2 then raise exception 'expected 2 settings rows, got %', n; end if;
  select count(*) into n from app_private.admins where user_id in (admin_id, member_id);
  if n <> 1 then raise exception 'expected 1 admin, got %', n; end if;

  -- RLS as the member.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.settings;
  if n <> 1 then raise exception 'member sees % settings rows', n; end if;
  select count(*) into n from public.invitations;
  if n <> 0 then raise exception 'member sees % invitations', n; end if;
  update public.settings set locale = 'es' where user_id = admin_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'member updated another user''s settings'; end if;
  begin
    update public.settings set user_id = admin_id where user_id = member_id;
    raise exception 'REASSIGN_ALLOWED';
  exception when others then
    if sqlerrm = 'REASSIGN_ALLOWED' then raise exception 'member could reassign settings.user_id'; end if;
  end;
  begin
    insert into public.invitations (email) values ('sneaky@huecos.test');
    raise exception 'INVITE_ALLOWED';
  exception when others then
    if sqlerrm = 'INVITE_ALLOWED' then raise exception 'member could invite'; end if;
  end;

  -- Admin sees and manages invitations.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.invitations;
  if n <> 2 then raise exception 'admin sees % invitations', n; end if;
  insert into public.invitations (email) values ('cousin@huecos.test');

  raise exception 'ALL_OK';
end;
$$;
