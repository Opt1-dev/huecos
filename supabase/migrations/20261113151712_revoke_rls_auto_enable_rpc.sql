-- Security advisor 0028/0029: public.rls_auto_enable() is a SECURITY DEFINER
-- event-trigger function created by Supabase (automatic RLS on new tables).
-- Being in the exposed public schema, PostgREST lists it as an RPC for anon and
-- authenticated. Event triggers do not need EXECUTE for the calling role, so
-- revoking it keeps the automatic RLS working while closing the endpoint.
-- The function only exists on hosted projects, hence the guard.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable' and p.pronargs = 0
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
