// sync-calendars: fetches every saved .ics feed server side, expands it and
// upserts the result into public.events.
// Callers: pg_cron (x-cron-secret header, all users) or a signed-in user
// (Authorization: Bearer <session JWT>, only their calendars).
import { parseIcs, type ParsedEvent } from '../_shared/ics.ts';
import { FeedFetchError, safeFetchText } from '../_shared/net.ts';
import { adminClient, corsHeaders, json, requestUserId } from '../_shared/http.ts';

const DAY = 86_400_000;
const PAST_DAYS = 7;
const FUTURE_DAYS = 60;
const USER_COOLDOWN_MS = 30_000;
const CONCURRENCY = 4;

interface Feed {
  calendar_id: string;
  user_id: string;
  role: string;
  url: string;
  timezone: string;
}

const admin = adminClient();

async function syncFeed(feed: Feed, fromMs: number, toMs: number): Promise<{ events: number; error?: string }> {
  let parsed: ParsedEvent[];
  try {
    const text = await safeFetchText(feed.url);
    if (!text.includes('BEGIN:VCALENDAR')) throw new FeedFetchError('not_ics');
    parsed = parseIcs(text, { fromMs, toMs, defaultTz: feed.timezone, role: feed.role });
  } catch (e) {
    const code = e instanceof FeedFetchError ? e.code : 'parse_failed';
    await admin.from('calendars').update({ last_error: code }).eq('id', feed.calendar_id);
    return { events: 0, error: code };
  }

  // One row per (uid, start): identical occurrences collapse.
  const rows = new Map<string, Record<string, unknown>>();
  const now = new Date().toISOString();
  for (const e of parsed) {
    const start = new Date(e.startMs).toISOString();
    rows.set(`${e.uid}\u0000${start}`, {
      user_id: feed.user_id,
      calendar_id: feed.calendar_id,
      uid: e.uid,
      title: e.title.slice(0, 500),
      start_at: start,
      end_at: new Date(e.endMs).toISOString(),
      all_day: e.allDay,
      event_type: e.eventType,
      status: e.status,
      updated_at: now,
    });
  }
  const values = [...rows.values()];
  for (let i = 0; i < values.length; i += 500) {
    const { error } = await admin
      .from('events')
      .upsert(values.slice(i, i + 500), { onConflict: 'calendar_id,uid,start_at' });
    if (error) {
      await admin.from('calendars').update({ last_error: 'db_write' }).eq('id', feed.calendar_id);
      return { events: 0, error: 'db_write' };
    }
  }

  // Remove events of this window that disappeared from the feed.
  const { data: existing } = await admin
    .from('events')
    .select('id, uid, start_at')
    .eq('calendar_id', feed.calendar_id)
    .gte('start_at', new Date(fromMs).toISOString())
    .lte('start_at', new Date(toMs).toISOString());
  const stale = (existing ?? [])
    .filter((r) => !rows.has(`${r.uid}\u0000${new Date(r.start_at).toISOString()}`))
    .map((r) => r.id as string);
  for (let i = 0; i < stale.length; i += 200) {
    await admin.from('events').delete().in('id', stale.slice(i, i + 200));
  }

  await admin
    .from('calendars')
    .update({ last_synced_at: now, last_error: null })
    .eq('id', feed.calendar_id);
  return { events: values.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const cronHeader = req.headers.get('x-cron-secret');
  let userId: string | null = null;

  if (cronHeader) {
    // pg_cron call: the secret lives only in Vault and is checked there.
    const { data: ok, error: checkError } = await admin.rpc('check_sync_cron_secret', { p_secret: cronHeader });
    if (checkError || ok !== true) return json({ error: 'unauthorized' }, 401);
    userId = null; // every user
  } else {
    userId = await requestUserId(req, admin);
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const { data: s } = await admin.from('settings').select('last_synced_at').eq('user_id', userId).maybeSingle();
    if (s?.last_synced_at && Date.now() - new Date(s.last_synced_at).getTime() < USER_COOLDOWN_MS) {
      return json({ error: 'too_soon', last_synced_at: s.last_synced_at }, 429);
    }
  }

  const { data: feeds, error } = await admin.rpc('calendar_feeds_for_sync', { p_user_id: userId });
  if (error) return json({ error: 'feeds_unavailable' }, 500);

  const now = Date.now();
  const fromMs = now - PAST_DAYS * DAY;
  const toMs = now + FUTURE_DAYS * DAY;
  const queue = [...((feeds ?? []) as Feed[])];
  const results: { calendar_id: string; events: number; error?: string }[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let feed = queue.shift(); feed; feed = queue.shift()) {
        results.push({ calendar_id: feed.calendar_id, ...(await syncFeed(feed, fromMs, toMs)) });
      }
    }),
  );

  const syncedAt = new Date().toISOString();
  const users = userId ? [userId] : [...new Set(((feeds ?? []) as Feed[]).map((f) => f.user_id))];
  if (users.length) await admin.from('settings').update({ last_synced_at: syncedAt }).in('user_id', users);

  return json({ synced_at: syncedAt, calendars: results });
});
