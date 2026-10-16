import dns from 'node:dns/promises';

const HOSTS = new Set(['api.bgm.tv', 'lain.bgm.tv']);

/** Credentials live in the server environment, never in client configuration. */
export function bangumiEgress(): { proxy: string; dnsServer: string } | undefined {
  const proxy = process.env.BANGUMI_HTTP_PROXY?.trim();
  const dnsServer = process.env.BANGUMI_DNS_SERVER?.trim();
  if (!proxy && !dnsServer) return undefined;
  try {
    const url = new URL(proxy || '');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash) throw new Error();
    if (!dnsServer || !/^127\.0\.0\.1:\d{1,5}$/.test(dnsServer)) throw new Error();
    const port = Number(dnsServer.split(':')[1]);
    if (port < 1 || port > 65535) throw new Error();
    return { proxy: url.href, dnsServer };
  } catch {
    throw new Error('新番专用出站配置无效');
  }
}

/** Only the calendar and known cover paths can use this route, including after redirects. */
export function usesBangumiEgress(value: string): boolean {
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) return false;
  const matches = (url.hostname === 'api.bgm.tv' && url.pathname === '/calendar') ||
    (url.hostname === 'lain.bgm.tv' && /^\/(?:r\/[0-9x]+\/)?pic\/cover\//.test(url.pathname));
  return matches && bangumiEgress() !== undefined;
}

const resolved = new Map<string, { expires: number; addresses: { address: string; family: number }[] }>();
const resolving = new Map<string, Promise<{ address: string; family: number }[]>>();

/** DNS for these two hosts travels inside the same VPN, then callers validate and pin the IP. */
export async function lookupUpstreamHost(hostname: string): Promise<{ address: string; family: number }[]> {
  const route = HOSTS.has(hostname) ? bangumiEgress() : undefined;
  if (!route) return dns.lookup(hostname, { all: true, verbatim: true });
  const key = `${route.dnsServer}:${hostname}`;
  const cached = resolved.get(key);
  if (cached && cached.expires > Date.now()) return cached.addresses;
  const existing = resolving.get(key);
  if (existing) return existing;
  const request = (async () => {
    const resolver = new dns.Resolver({ timeout: 5000, tries: 1 });
    resolver.setServers([route.dnsServer]);
    const records = await resolver.resolve4(hostname, { ttl: true });
    const addresses = records.map(({ address }) => ({ address, family: 4 }));
    if (!addresses.length) throw new Error('新番来源域名解析失败');
    const ttl = Math.min(60, ...records.map(({ ttl }) => Math.max(1, ttl)));
    resolved.set(key, { expires: Date.now() + ttl * 1000, addresses });
    return addresses;
  })();
  resolving.set(key, request);
  try { return await request; } finally { resolving.delete(key); }
}
