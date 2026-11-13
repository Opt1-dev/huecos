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
  supabase.auth.onAuthStateChange((_event, next) => {
    session.value = next;
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

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
