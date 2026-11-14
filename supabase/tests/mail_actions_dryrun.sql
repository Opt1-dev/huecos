-- Assertions for the mail_actions migration. The final RAISE always aborts,
-- so nothing is kept.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  st text;
  acc uuid;
  acc2 uuid;
  secret_id uuid;
  n int;
  tok text;
  ret text;
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'a@huecos.test', 'authenticated', 'authenticated'),
    (b, 'b@huecos.test', 'authenticated', 'authenticated');

  -- Users can't call the service functions.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.mail_accounts_for_check(null);
    raise exception 'TOKENS_READABLE';
  exception when others then
    if sqlerrm = 'TOKENS_READABLE' then raise exception 'authenticated could read mailbox tokens'; end if;
  end;
  begin
    perform public.mail_account_save(a, 'microsoft', 'a@outlook.test', 'tok');
    raise exception 'SAVE_ALLOWED';
  exception when others then
    if sqlerrm = 'SAVE_ALLOWED' then raise exception 'authenticated could save a mailbox'; end if;
  end;
  begin
    insert into public.mail_accounts (user_id, provider, address) values (a, 'microsoft', 'x@y.test');
    raise exception 'ACCOUNT_INSERT';
  exception when others then
    if sqlerrm = 'ACCOUNT_INSERT' then raise exception 'authenticated could insert a mailbox'; end if;
  end;

  -- OAuth state: single use.
  perform set_config('role', 'service_role', true);
  st := public.mail_oauth_begin(a, 'microsoft', 'verifier-123', 'https://opt1-dev.github.io/huecos/');
  select r.return_to into ret from public.mail_oauth_take(st) r;
  if ret is distinct from 'https://opt1-dev.github.io/huecos/' then raise exception 'state not returned'; end if;
  select count(*) into n from public.mail_oauth_take(st);
  if n <> 0 then raise exception 'state used twice'; end if;

  -- Saving a mailbox stores the token in Vault; saving again updates it.
  acc := public.mail_account_save(a, 'microsoft', 'A@Outlook.test', 'refresh-1');
  acc2 := public.mail_account_save(a, 'microsoft', 'a@outlook.test', 'refresh-2');
  if acc <> acc2 then raise exception 'reconnecting created a second mailbox'; end if;
  select f.token into tok from public.mail_accounts_for_check(a) f where f.account_id = acc;
  if tok <> 'refresh-2' then raise exception 'token not updated: %', tok; end if;
  perform public.mail_token_update(acc, 'refresh-3');
  select f.token into tok from public.mail_accounts_for_check(null) f where f.account_id = acc;
  if tok <> 'refresh-3' then raise exception 'token not rotated'; end if;
  select token_secret_id into secret_id from public.mail_accounts where id = acc;

  -- A hit written by the service.
  insert into public.mail_hits (user_id, account_id, message_id, subject, received_at, keywords, web_link)
  values (a, acc, 'm1', 'Retroalimentación', now(), '{retroalimentacion}', 'https://outlook.office.com/x');

  -- The owner sees their mailbox (without the token) and hit, marks it done, adds keywords.
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.mail_accounts where id = acc;
  if n <> 1 then raise exception 'owner cannot see their mailbox'; end if;
  begin
    perform token_secret_id from public.mail_accounts where id = acc;
    raise exception 'SECRET_REF_READABLE';
  exception when others then
    if sqlerrm = 'SECRET_REF_READABLE' then raise exception 'owner can read the Vault reference'; end if;
  end;
  update public.mail_hits set done = true where account_id = acc;
  select count(*) into n from public.mail_hits where account_id = acc and done;
  if n <> 1 then raise exception 'owner cannot mark a hit done'; end if;
  begin
    update public.mail_hits set subject = 'x' where account_id = acc;
    raise exception 'SUBJECT_WRITABLE';
  exception when others then
    if sqlerrm = 'SUBJECT_WRITABLE' then raise exception 'hit subject writable'; end if;
  end;
  insert into public.mail_keywords (keyword, sender) values ('retroalimentación', 'cesurformacion.com');
  begin
    insert into public.mail_keywords (keyword, sender) values ('  Retroalimentación ', 'CESURformacion.com');
    raise exception 'DUP_KEYWORD';
  exception when others then
    if sqlerrm = 'DUP_KEYWORD' then raise exception 'duplicate keyword accepted'; end if;
  end;

  -- B sees nothing of A.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select (select count(*) from public.mail_accounts) + (select count(*) from public.mail_hits) + (select count(*) from public.mail_keywords) into n;
  if n <> 0 then raise exception 'B sees % rows of A', n; end if;

  -- Disconnecting removes the hits and the Vault token.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from public.mail_accounts where id = acc;
  perform set_config('role', 'postgres', true);
  select (select count(*) from public.mail_hits where account_id = acc) + (select count(*) from vault.secrets where id = secret_id) into n;
  if n <> 0 then raise exception 'disconnect left % rows', n; end if;

  raise exception 'ALL_OK';
end;
$$;
