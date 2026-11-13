// Admin-only calls. Every database function checks the caller again.
import { supabase } from './supabase';

export async function amIAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('am_i_admin');
  return !error && data === true;
}

export async function getSignupCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_signup_code');
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function rotateSignupCode(): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_signup_code');
  if (error) throw new Error(error.message);
  return data as string;
}

export async function disableSignupCode(): Promise<void> {
  const { error } = await supabase.rpc('disable_signup_code');
  if (error) throw new Error(error.message);
}

/** The permanent sign-up link for a code. */
export function signupLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?join=${code}`;
}
