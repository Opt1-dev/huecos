// Admin-only calls. Every database function checks the caller again.
import { signal } from '@preact/signals';
import { supabase } from './supabase';
import { demoMode } from './data';

/** null = not checked yet. */
export const isAdmin = signal<boolean | null>(null);

export async function amIAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('am_i_admin');
  return !error && data === true;
}

export async function loadAdminFlag(): Promise<void> {
  isAdmin.value = demoMode.value ? true : await amIAdmin();
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Sign-up link (single use)
// ---------------------------------------------------------------------------
export async function getSignupCode(): Promise<string | null> {
  if (demoMode.value) return '0123456789abcdef0123456789abcdef0123';
  const { data, error } = await supabase.rpc('get_signup_code');
  fail(error);
  return (data as string | null) ?? null;
}

export async function rotateSignupCode(): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_signup_code');
  fail(error);
  return data as string;
}

export async function disableSignupCode(): Promise<void> {
  const { error } = await supabase.rpc('disable_signup_code');
  fail(error);
}

/** The sign-up link for a code. */
export function signupLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?join=${code}`;
}

// ---------------------------------------------------------------------------
// Accounts and bans
// ---------------------------------------------------------------------------
export interface AccountRow {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  banned: boolean;
  is_admin: boolean;
}

export interface BannedEmailRow {
  email: string;
  banned_at: string;
  has_account: boolean;
}

/** Dev-only sample data for ?demo. */
const DEMO_ACCOUNTS: AccountRow[] = [
  { id: 'demo', email: 'moi@example.com', created_at: '2026-11-13T10:00:00Z', last_sign_in_at: '2026-11-13T18:00:00Z', banned: false, is_admin: true },
  { id: 'u2', email: 'camarade@example.com', created_at: '2026-11-13T19:00:00Z', last_sign_in_at: null, banned: false, is_admin: false },
  { id: 'u3', email: 'ancien@example.com', created_at: '2026-11-10T09:00:00Z', last_sign_in_at: '2026-11-11T09:00:00Z', banned: true, is_admin: false },
];

export async function listAccounts(): Promise<AccountRow[]> {
  if (demoMode.value) return DEMO_ACCOUNTS;
  const { data, error } = await supabase.rpc('admin_list_users');
  fail(error);
  return (data ?? []) as AccountRow[];
}

export async function banAccount(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_ban_user', { p_user_id: userId });
  fail(error);
}

export async function unbanAccount(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_unban_user', { p_user_id: userId });
  fail(error);
}

/** Delete an account and all its data, for good. */
export async function deleteAccount(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
  fail(error);
}

export async function listBannedEmails(): Promise<BannedEmailRow[]> {
  if (demoMode.value) return [{ email: 'spam@example.com', banned_at: '2026-11-12T10:00:00Z', has_account: false }];
  const { data, error } = await supabase.rpc('admin_list_banned_emails');
  fail(error);
  return (data ?? []) as BannedEmailRow[];
}

export async function banEmail(email: string): Promise<void> {
  const { error } = await supabase.rpc('admin_ban_email', { p_email: email });
  fail(error);
}

export async function unbanEmail(email: string): Promise<void> {
  const { error } = await supabase.rpc('admin_unban_email', { p_email: email });
  fail(error);
}
