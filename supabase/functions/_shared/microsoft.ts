// Microsoft sign-in (OAuth 2.0 authorization code + PKCE) and Microsoft Graph
// mail reading for "Action requise". Deno only.

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
export const MS_SCOPES = 'offline_access openid email User.Read Mail.Read';
const TIMEOUT_MS = 15_000;

export class ProviderError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

export function msConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = Deno.env.get('MS_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_CLIENT_SECRET');
  const base = Deno.env.get('SUPABASE_URL');
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/functions/v1/mail-oauth-callback` };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE pair: a random verifier and its SHA-256 challenge. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64url(digest) };
}

export function msAuthorizeUrl(cfg: { clientId: string; redirectUri: string }, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: MS_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${AUTHORITY}/authorize?${q}`;
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string') {
    // invalid_grant: the user revoked access, changed password or the token expired.
    const code = data.error === 'invalid_grant' ? 'reconnect' : data.error === 'consent_required' ? 'consent_required' : 'token_failed';
    throw new ProviderError(code, String(data.error_description ?? data.error ?? res.status));
  }
  return data as unknown as TokenSet;
}

export function msExchangeCode(cfg: { clientId: string; clientSecret: string; redirectUri: string }, code: string, verifier: string) {
  return tokenRequest({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
    scope: MS_SCOPES,
  });
}

export function msRefresh(cfg: { clientId: string; clientSecret: string }, refreshToken: string) {
  return tokenRequest({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: MS_SCOPES,
  });
}

async function graph(url: string, accessToken: string, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown>> {
  if (!url.startsWith(GRAPH)) throw new ProviderError('bad_url');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new ProviderError('reconnect');
  if (!res.ok) throw new ProviderError(`graph_${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function msAddress(accessToken: string): Promise<string> {
  const me = await graph(`${GRAPH}/me?$select=mail,userPrincipalName`, accessToken);
  const address = (me.mail as string | null) || (me.userPrincipalName as string | null);
  if (!address) throw new ProviderError('no_address');
  return address;
}

export interface MailMessage {
  id: string;
  subject: string;
  body: string;
  senderName: string;
  senderAddress: string;
  receivedAt: string;
  webLink: string | null;
}

/** Inbox messages received since `sinceIso`, oldest first, at most `max`. */
export async function msMessagesSince(accessToken: string, sinceIso: string, max = 200): Promise<MailMessage[]> {
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${sinceIso}`,
    $orderby: 'receivedDateTime asc',
    $top: '50',
    $select: 'id,subject,from,receivedDateTime,body,webLink',
  });
  let url: string | null = `${GRAPH}/me/mailFolders/inbox/messages?${q}`;
  const out: MailMessage[] = [];
  while (url && out.length < max) {
    const page = await graph(url, accessToken, { Prefer: 'outlook.body-content-type="text"' });
    for (const m of (page.value as Record<string, any>[]) ?? []) {
      out.push({
        id: String(m.id),
        subject: String(m.subject ?? ''),
        body: String(m.body?.content ?? ''),
        senderName: String(m.from?.emailAddress?.name ?? ''),
        senderAddress: String(m.from?.emailAddress?.address ?? ''),
        receivedAt: String(m.receivedDateTime),
        webLink: typeof m.webLink === 'string' && m.webLink.startsWith('https://') ? m.webLink : null,
      });
    }
    url = typeof page['@odata.nextLink'] === 'string' ? (page['@odata.nextLink'] as string) : null;
  }
  return out.slice(0, max);
}

/** Where the app may send the user back after signing in. */
const RETURN_ORIGINS = ['https://opt1-dev.github.io', 'https://huecos.toloben.es', 'http://localhost:5173'];
export const DEFAULT_RETURN = 'https://opt1-dev.github.io/huecos/';

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    if (!RETURN_ORIGINS.includes(u.origin)) return null;
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}
