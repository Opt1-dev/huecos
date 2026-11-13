import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Publishable key: safe in the browser, access is enforced by RLS.
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !publishableKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (see app/.env.example).');
}

export const supabase = createClient(url, publishableKey, {
  // Implicit flow: a sign-in link works in whichever browser opens it (PKCE only
  // works in the browser that asked for it, which breaks phone ↔ computer and
  // mail-app browsers). The 6-digit code in the same email covers installed PWAs.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});
