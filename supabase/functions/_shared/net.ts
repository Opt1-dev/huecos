// Network side of feed fetching (Deno only): DNS check, redirects, size and time limits.
import { FeedUrlError, isIpLiteral, isPrivateAddress, normalizeFeedUrl } from './feed-url.ts';

export class FeedFetchError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

/** Refuse hosts that resolve to private or reserved addresses. */
export async function assertPublicHost(host: string): Promise<void> {
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIpLiteral(bare)) {
    if (isPrivateAddress(bare)) throw new FeedFetchError('blocked_host');
    return;
  }
  const results = await Promise.allSettled([Deno.resolveDns(bare, 'A'), Deno.resolveDns(bare, 'AAAA')]);
  const addresses = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const unsupported = results.every(
    (r) => r.status === 'rejected' && /not ?supported|permission/i.test(String(r.reason)),
  );
  if (unsupported) return; // runtime without DNS API: the syntactic checks still apply
  if (addresses.length === 0) throw new FeedFetchError('dns_failed');
  if (addresses.some((a) => isPrivateAddress(a))) throw new FeedFetchError('blocked_host');
}

/** GET a feed with redirects re-validated at each hop, a 15 s timeout and a 5 MB cap. */
export async function safeFetchText(input: string): Promise<string> {
  let current = input;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: string;
    let host: string;
    try {
      ({ url, host } = normalizeFeedUrl(current));
    } catch (e) {
      throw new FeedFetchError(e instanceof FeedUrlError ? `url_${e.code}` : 'url_invalid');
    }
    await assertPublicHost(host);

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'Huecos-calendar-sync/1.0', accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' },
      });
    } catch (e) {
      throw new FeedFetchError(e instanceof DOMException && e.name === 'TimeoutError' ? 'timeout' : 'network');
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new FeedFetchError(`http_${res.status}`);
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new FeedFetchError(`http_${res.status}`);
    }

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) {
      await res.body?.cancel();
      throw new FeedFetchError('too_large');
    }
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new FeedFetchError('too_large');
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder().decode(buf);
  }
  throw new FeedFetchError('too_many_redirects');
}
