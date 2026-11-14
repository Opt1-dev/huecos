// "Action requise": connected mailboxes, keywords and matching mails.
import { signal } from '@preact/signals';
import { supabase } from './supabase';
import { demoMode } from './data';
import { session } from './session';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface MailAccountRow {
  id: string;
  provider: 'microsoft' | 'google';
  address: string;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface MailKeywordRow {
  id: string;
  keyword: string;
  sender: string | null;
}

export interface MailHitRow {
  id: string;
  account_id: string;
  subject: string;
  sender_name: string;
  sender_address: string;
  received_at: string;
  snippet: string;
  keywords: string[];
  web_link: string | null;
  done: boolean;
}

const ACCOUNT_COLUMNS = 'id, provider, address, last_checked_at, last_error, created_at';
const HIT_COLUMNS = 'id, account_id, subject, sender_name, sender_address, received_at, snippet, keywords, web_link, done';

export const mailAccounts = signal<MailAccountRow[]>([]);
export const mailKeywords = signal<MailKeywordRow[]>([]);
export const mailHits = signal<MailHitRow[]>([]);
export const mailChecking = signal(false);

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function loadMail(): Promise<void> {
  if (demoMode.value) return;
  const [acc, kw, hits] = await Promise.all([
    supabase.from('mail_accounts').select(ACCOUNT_COLUMNS).order('created_at'),
    supabase.from('mail_keywords').select('id, keyword, sender').order('created_at'),
    supabase.from('mail_hits').select(HIT_COLUMNS).order('received_at', { ascending: false }).limit(300),
  ]);
  fail(acc.error);
  fail(kw.error);
  fail(hits.error);
  mailAccounts.value = (acc.data ?? []) as MailAccountRow[];
  mailKeywords.value = (kw.data ?? []) as MailKeywordRow[];
  mailHits.value = (hits.data ?? []) as MailHitRow[];
}

export async function reloadHits(): Promise<void> {
  const { data, error } = await supabase.from('mail_hits').select(HIT_COLUMNS).order('received_at', { ascending: false }).limit(300);
  fail(error);
  mailHits.value = (data ?? []) as MailHitRow[];
}

let channel: RealtimeChannel | null = null;
/** New matching mails show up (and the badge updates) without reloading. */
export function startMailRealtime(): void {
  const userId = session.value?.user.id;
  if (!userId || channel || demoMode.value) return;
  channel = supabase
    .channel(`mail-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mail_hits', filter: `user_id=eq.${userId}` }, () =>
      void reloadHits().catch(() => undefined),
    )
    .subscribe();
}

export function stopMailRealtime(): void {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
}

/** Error code returned by an Edge Function, or a generic one. */
async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      /* not JSON */
    }
  }
  return 'network';
}

/** Sends the browser to Microsoft's sign-in; it comes back with ?mail=… */
export async function connectMicrosoft(): Promise<{ error: string | null }> {
  const returnTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const { data, error } = await supabase.functions.invoke('mail-connect', { body: { provider: 'microsoft', return_to: returnTo } });
  if (error) return { error: await functionError(error) };
  const url = (data as { url?: string }).url;
  if (!url?.startsWith('https://login.microsoftonline.com/')) return { error: 'bad_response' };
  window.location.assign(url);
  return { error: null };
}

export async function checkMailNow(): Promise<{ error: string | null }> {
  mailChecking.value = true;
  try {
    const { error } = await supabase.functions.invoke('check-mail', { body: { scope: 'me' } });
    const code = error ? await functionError(error) : null;
    await loadMail();
    return { error: code === 'too_soon' ? null : code };
  } finally {
    mailChecking.value = false;
  }
}

export async function disconnectMailbox(id: string): Promise<void> {
  const { error } = await supabase.from('mail_accounts').delete().eq('id', id);
  fail(error);
  mailAccounts.value = mailAccounts.value.filter((a) => a.id !== id);
  mailHits.value = mailHits.value.filter((h) => h.account_id !== id);
}

export async function addKeyword(keyword: string, sender: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('mail_keywords')
    .insert({ keyword: keyword.trim(), sender: sender?.trim() || null })
    .select('id, keyword, sender')
    .single();
  fail(error);
  mailKeywords.value = [...mailKeywords.value, data as MailKeywordRow];
}

export async function deleteKeyword(id: string): Promise<void> {
  const { error } = await supabase.from('mail_keywords').delete().eq('id', id);
  fail(error);
  mailKeywords.value = mailKeywords.value.filter((k) => k.id !== id);
}

export async function setHitDone(id: string, done: boolean): Promise<void> {
  if (!demoMode.value) {
    const { error } = await supabase.from('mail_hits').update({ done }).eq('id', id);
    fail(error);
  }
  mailHits.value = mailHits.value.map((h) => (h.id === id ? { ...h, done } : h));
}

export async function deleteDoneHits(): Promise<void> {
  const ids = mailHits.value.filter((h) => h.done).map((h) => h.id);
  if (ids.length === 0) return;
  if (!demoMode.value) {
    const { error } = await supabase.from('mail_hits').delete().in('id', ids);
    fail(error);
  }
  mailHits.value = mailHits.value.filter((h) => !h.done);
}

/** ?mail=connected | ?mail=error&reason=… after the Microsoft round trip; removed from the address bar. */
export function takeMailReturn(): { ok: boolean; reason: string } | null {
  const url = new URL(window.location.href);
  const mail = url.searchParams.get('mail');
  if (!mail) return null;
  const reason = url.searchParams.get('reason') ?? '';
  url.searchParams.delete('mail');
  url.searchParams.delete('reason');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return { ok: mail === 'connected', reason };
}
