// save-feed: validates a calendar feed URL, checks that it really serves
// iCalendar data and stores it encrypted in Vault. The URL is never returned.
import { FeedUrlError, normalizeFeedUrl } from '../_shared/feed-url.ts';
import { FeedFetchError, safeFetchText } from '../_shared/net.ts';
import { adminClient, corsHeaders, json, requestUserId } from '../_shared/http.ts';

const admin = adminClient();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const userId = await requestUserId(req, admin);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  let body: { calendar_id?: unknown; url?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const calendarId = typeof body.calendar_id === 'string' && UUID.test(body.calendar_id) ? body.calendar_id : null;
  const raw = typeof body.url === 'string' && body.url.length <= 2048 ? body.url : null;
  if (!calendarId || !raw) return json({ error: 'bad_request' }, 400);

  let url: string;
  let host: string;
  try {
    ({ url, host } = normalizeFeedUrl(raw));
  } catch (e) {
    return json({ error: e instanceof FeedUrlError ? `url_${e.code}` : 'url_invalid' }, 400);
  }

  try {
    const text = await safeFetchText(url);
    if (!text.includes('BEGIN:VCALENDAR')) return json({ error: 'not_ics' }, 422);
  } catch (e) {
    return json({ error: e instanceof FeedFetchError ? e.code : 'network' }, 422);
  }

  const { error } = await admin.rpc('set_calendar_feed', {
    p_calendar_id: calendarId,
    p_user_id: userId,
    p_url: url,
    p_host: host,
  });
  if (error) return json({ error: error.code === 'P0002' ? 'calendar_not_found' : 'db_write' }, error.code === 'P0002' ? 404 : 500);
  return json({ host });
});
