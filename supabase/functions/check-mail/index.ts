// check-mail: reads the new mails of every connected mailbox and records the
// ones containing a keyword (subject or text). Only an excerpt is kept.
// Callers: pg_cron (x-cron-secret header, all users) or a signed-in user
// (Authorization: Bearer <session JWT>, only their mailboxes).
import { adminClient, corsHeaders, json, requestUserId } from '../_shared/http.ts';
import { type Keyword, matchMail } from '../_shared/mailmatch.ts';
import { msConfig, msMessagesSince, msRefresh, ProviderError } from '../_shared/microsoft.ts';

const USER_COOLDOWN_MS = 30_000;
/** Look a little before the last check, in case a mail arrived late. */
const OVERLAP_MS = 5 * 60_000;

interface Account {
  account_id: string;
  user_id: string;
  provider: string;
  address: string;
  token: string;
  checked_until: string;
}

const admin = adminClient();

async function checkAccount(acc: Account, keywords: Keyword[]): Promise<{ hits: number; error?: string }> {
  const startedAt = new Date().toISOString();
  try {
    if (acc.provider !== 'microsoft') throw new ProviderError('unsupported_provider');
    const cfg = msConfig();
    if (!cfg) throw new ProviderError('not_configured');
    const tokens = await msRefresh(cfg, acc.token);
    if (tokens.refresh_token && tokens.refresh_token !== acc.token) {
      await admin.rpc('mail_token_update', { p_account_id: acc.account_id, p_token: tokens.refresh_token });
    }

    const since = new Date(new Date(acc.checked_until).getTime() - OVERLAP_MS).toISOString();
    const messages = await msMessagesSince(tokens.access_token, since);
    const rows = [];
    for (const m of messages) {
      const hit = keywords.length ? matchMail(m, keywords) : null;
      if (!hit) continue;
      rows.push({
        user_id: acc.user_id,
        account_id: acc.account_id,
        message_id: m.id.slice(0, 1000),
        subject: m.subject.slice(0, 500),
        sender_name: m.senderName.slice(0, 200),
        sender_address: m.senderAddress.slice(0, 320),
        received_at: m.receivedAt,
        snippet: hit.snippet.slice(0, 400),
        keywords: hit.keywords,
        web_link: m.webLink,
      });
    }
    if (rows.length) {
      const { error } = await admin.from('mail_hits').upsert(rows, { onConflict: 'account_id,message_id', ignoreDuplicates: true });
      if (error) throw new ProviderError('db_write');
    }
    // Up to the newest mail read (or now when the inbox was quiet).
    const newest = messages.length ? messages[messages.length - 1]!.receivedAt : startedAt;
    await admin
      .from('mail_accounts')
      .update({ checked_until: newest > startedAt ? startedAt : newest, last_checked_at: startedAt, last_error: null })
      .eq('id', acc.account_id);
    return { hits: rows.length };
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : 'failed';
    await admin.from('mail_accounts').update({ last_checked_at: startedAt, last_error: code }).eq('id', acc.account_id);
    return { hits: 0, error: code };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const cronHeader = req.headers.get('x-cron-secret');
  let userId: string | null = null;
  if (cronHeader) {
    const { data: ok, error } = await admin.rpc('check_sync_cron_secret', { p_secret: cronHeader });
    if (error || ok !== true) return json({ error: 'unauthorized' }, 401);
  } else {
    userId = await requestUserId(req, admin);
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const { data: recent } = await admin
      .from('mail_accounts')
      .select('last_checked_at')
      .eq('user_id', userId)
      .order('last_checked_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (recent?.last_checked_at && Date.now() - new Date(recent.last_checked_at).getTime() < USER_COOLDOWN_MS) {
      return json({ error: 'too_soon' }, 429);
    }
  }

  const { data: accounts, error } = await admin.rpc('mail_accounts_for_check', { p_user_id: userId });
  if (error) return json({ error: 'accounts_unavailable' }, 500);
  const list = (accounts ?? []) as Account[];

  const users = [...new Set(list.map((a) => a.user_id))];
  const { data: kw } = users.length
    ? await admin.from('mail_keywords').select('user_id, keyword, sender').in('user_id', users)
    : { data: [] };
  const byUser = new Map<string, Keyword[]>();
  for (const k of (kw ?? []) as { user_id: string; keyword: string; sender: string | null }[]) {
    const l = byUser.get(k.user_id) ?? [];
    l.push({ keyword: k.keyword, sender: k.sender });
    byUser.set(k.user_id, l);
  }

  const results = [];
  for (const acc of list) {
    results.push({ account_id: acc.account_id, ...(await checkAccount(acc, byUser.get(acc.user_id) ?? [])) });
  }
  return json({ checked_at: new Date().toISOString(), accounts: results });
});
