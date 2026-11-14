// mail-oauth-callback: Microsoft sends the user back here after sign-in.
// Exchanges the code, stores the refresh token in Vault, then sends the user
// back to the app with ?mail=connected or ?mail=error&reason=…
import { adminClient } from '../_shared/http.ts';
import { DEFAULT_RETURN, msAddress, msConfig, msExchangeCode, ProviderError } from '../_shared/microsoft.ts';

const admin = adminClient();

function back(returnTo: string, params: Record<string, string>): Response {
  const url = new URL(returnTo);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const q = new URL(req.url).searchParams;
  const state = q.get('state') ?? '';

  const { data: rows } = state.length >= 32 ? await admin.rpc('mail_oauth_take', { p_state: state }) : { data: null };
  const pending = Array.isArray(rows) ? (rows[0] as { user_id: string; code_verifier: string; return_to: string } | undefined) : undefined;
  if (!pending) return back(DEFAULT_RETURN, { mail: 'error', reason: 'expired' });

  // The user cancelled, or their organisation needs an admin's approval.
  const providerError = q.get('error');
  if (providerError) {
    const reason = /consent|admin/i.test(`${providerError} ${q.get('error_description') ?? ''}`) ? 'admin_consent' : 'cancelled';
    return back(pending.return_to, { mail: 'error', reason });
  }

  const cfg = msConfig();
  const code = q.get('code');
  if (!cfg || !code) return back(pending.return_to, { mail: 'error', reason: 'not_configured' });

  try {
    const tokens = await msExchangeCode(cfg, code, pending.code_verifier);
    if (!tokens.refresh_token) throw new ProviderError('no_refresh_token');
    const address = await msAddress(tokens.access_token);
    const { error } = await admin.rpc('mail_account_save', {
      p_user_id: pending.user_id,
      p_provider: 'microsoft',
      p_address: address,
      p_token: tokens.refresh_token,
    });
    if (error) throw new ProviderError('save_failed');
    return back(pending.return_to, { mail: 'connected' });
  } catch (e) {
    const reason = e instanceof ProviderError ? e.code : 'failed';
    return back(pending.return_to, { mail: 'error', reason });
  }
});
