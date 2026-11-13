import { describe, expect, it } from 'vitest';
import { FeedUrlError, isPrivateAddress, normalizeFeedUrl } from './feed-url.ts';

const code = (input: string) => {
  try {
    normalizeFeedUrl(input);
    return 'ok';
  } catch (e) {
    return e instanceof FeedUrlError ? e.code : 'other';
  }
};

describe('normalizeFeedUrl', () => {
  it('accepts a Google secret iCal address and keeps only https', () => {
    const r = normalizeFeedUrl('  https://calendar.google.com/calendar/ical/abc%40group/private-x/basic.ics#frag ');
    expect(r.host).toBe('calendar.google.com');
    expect(r.url).toBe('https://calendar.google.com/calendar/ical/abc%40group/private-x/basic.ics');
  });
  it('turns webcal:// into https://', () => {
    expect(normalizeFeedUrl('webcal://example.com/feed.ics').url).toBe('https://example.com/feed.ics');
  });
  it.each([
    ['http://example.com/a.ics', 'protocol'],
    ['file:///etc/passwd', 'protocol'],
    ['https://user:pw@example.com/a.ics', 'credentials'],
    ['https://example.com:8443/a.ics', 'port'],
    ['https://localhost/a.ics', 'host'],
    ['https://printer.local/a.ics', 'host'],
    ['https://intranet/a.ics', 'host'],
    ['https://127.0.0.1/a.ics', 'host'],
    ['https://10.1.2.3/a.ics', 'host'],
    ['https://169.254.169.254/latest/meta-data', 'host'],
    ['https://[::1]/a.ics', 'host'],
    ['https://[::ffff:192.168.1.1]/a.ics', 'host'],
    ['not a url', 'invalid'],
  ])('rejects %s (%s)', (input, expected) => {
    expect(code(input)).toBe(expected);
  });
  it('accepts a public IP literal', () => {
    expect(code('https://8.8.8.8/a.ics')).toBe('ok');
  });
});

describe('isPrivateAddress', () => {
  it.each(['10.0.0.1', '172.16.5.4', '192.168.0.10', '100.64.1.1', '127.0.0.1', '0.0.0.0', '::', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a00:1'])(
    '%s is private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '142.250.184.14', '2a00:1450:4003:80e::200e'])('%s is public', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});
