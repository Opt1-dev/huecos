-- Admins can delete an account for good. Every Huecos table references
-- auth.users with ON DELETE CASCADE (settings, calendars and their Vault feed
-- secrets, events, overrides, tasks, entries, blocked days, done deadlines),
-- and so do Supabase's own auth tables (sessions, identities…).
-- The email's invitation, if any, is removed too, so it can't sign up again
-- without a new link or invitation. Admins (and so yourself) can't be deleted.
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_email text;
begin
  perform app_private.require_admin();
  if exists (select 1 from app_private.admins a where a.user_id = p_user_id) then
    raise exception 'an admin cannot be deleted' using errcode = '42501';
  end if;
  delete from auth.users u where u.id = p_user_id returning lower(u.email) into target_email;
  if not found then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  delete from public.invitations i where i.email = target_email;
end;
$$;
revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
