// Validation of user-supplied calendar feed URLs (SSRF protection, pure part).

export class FeedUrlError extends Error {
  constructor(public code: 'invalid' | 'protocol' | 'credentials' | 'port' | 'host') {
    super(`feed url rejected: ${code}`);
  }
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet'];

/** Accepts https:// or webcal:// URLs to a public host; returns the https URL and its host. */
export function normalizeFeedUrl(input: string): { url: string; host: string } {
  let raw = input.trim();
  if (/^webcals?:\/\//i.test(raw)) raw = raw.replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FeedUrlError('invalid');
  }
  if (u.protocol !== 'https:') throw new FeedUrlError('protocol');
  if (u.username || u.password) throw new FeedUrlError('credentials');
  if (u.port && u.port !== '443') throw new FeedUrlError('port');

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes('.') && !host.startsWith('[')) {
    throw new FeedUrlError('host');
  }
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIpLiteral(literal) && isPrivateAddress(literal)) throw new FeedUrlError('host');
  u.hash = '';
  return { url: u.toString(), host };
}

export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function inV4Range(ip: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((b & mask) >>> 0);
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded IPv4 (::ffff:1.2.3.4)
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const n = ipv4ToInt(v4[1]!);
    if (n === null) return null;
    s = s.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) || nums.length !== 8 ? null : nums;
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved and documentation ranges. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return V4_BLOCKED.some(([base, bits]) => inV4Range(v4, base, bits));

  const g = expandV6(ip);
  if (!g) return true; // unparseable: refuse
  const allZero = g.every((x) => x === 0);
  if (allZero) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  const mapped = g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0);
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) {
    const v4 = `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
    return isPrivateAddress(v4);
  }
  return false;
}
