import { signal } from '@preact/signals';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** undefined = still loading, null = signed out. */
export const session = signal<Session | null | undefined>(undefined);
export const online = signal<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);

export function startSessionTracking(): void {
  void supabase.auth.getSession().then(({ data }) => {
    session.value = data.session;
  });
  supabase.auth.onAuthStateChange((event, next) => {
    session.value = next;
    if (event === 'PASSWORD_RECOVERY') passwordRecovery.value = true;
  });
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
}

export async function sendMagicLink(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
  });
  return { error: error?.message ?? null };
}

/** Sign in with the numeric code from the email (works inside an installed PWA). */
export async function verifyEmailCode(email: string, code: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  return { error: error?.message ?? null };
}

/** Digits only, as typed or pasted ("123 456", "123-456"). */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '');
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Set when the user opened a password-reset link: the app asks for a new password. */
export const passwordRecovery = signal(false);

export const MIN_PASSWORD = 8;

/** Sign-up code from a ?join=… link, if any. */
export function joinCode(): string | null {
  if (typeof location === 'undefined') return null;
  const code = new URLSearchParams(location.search).get('join');
  return code && /^[0-9a-f]{24,64}$/i.test(code) ? code : null;
}

/** Remove ?join=… from the address bar (after sign-up, or to go to sign-in). */
export function clearJoinCode(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has('join')) return;
  url.searchParams.delete('join');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/**
 * Create an account with the sign-up link's code. With email confirmation off,
 * the user is signed in at once (`signedIn`); otherwise they must confirm first.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  code: string,
): Promise<{ error: string | null; signedIn: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { signup_code: code }, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
  });
  return { error: error?.message ?? null, signedIn: Boolean(data.session) };
}

export async function signInWithPassword(email: string, password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function sendPasswordReset(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + import.meta.env.BASE_URL,
  });
  return { error: error?.message ?? null };
}

export async function updatePassword(password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password });
  if (!error) passwordRecovery.value = false;
  return { error: error?.message ?? null };
}
