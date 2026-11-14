// mail-connect: starts "Se connecter avec Microsoft" for the signed-in user.
// Returns the Microsoft sign-in URL; the app then navigates to it.
import { adminClient, corsHeaders, json, requestUserId } from '../_shared/http.ts';
import { msAuthorizeUrl, msConfig, pkce, safeReturnTo } from '../_shared/microsoft.ts';

const admin = adminClient();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const userId = await requestUserId(req, admin);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as { provider?: string; return_to?: string };
  if (body.provider !== 'microsoft') return json({ error: 'unsupported_provider' }, 400);
  const returnTo = safeReturnTo(body.return_to);
  if (!returnTo) return json({ error: 'bad_return_to' }, 400);

  const cfg = msConfig();
  if (!cfg) return json({ error: 'not_configured' }, 503);

  const { verifier, challenge } = await pkce();
  const { data: state, error } = await admin.rpc('mail_oauth_begin', {
    p_user_id: userId,
    p_provider: 'microsoft',
    p_code_verifier: verifier,
    p_return_to: returnTo,
  });
  if (error || typeof state !== 'string') return json({ error: 'state_failed' }, 500);

  return json({ url: msAuthorizeUrl(cfg, state, challenge) });
});
