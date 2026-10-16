import type { LookupFunction } from 'node:net';
import { Agent, Client, Dispatcher, ProxyAgent } from 'undici';
import { isPrivateIP } from './ssrf';
import { bangumiEgress, lookupUpstreamHost, usesBangumiEgress } from './bangumi-egress';

/** 校验用于实际 socket 连接的同一批 DNS 结果，防止预检后 DNS 重绑定。 */
export function createSafeLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    void lookupUpstreamHost(hostname).then((addresses) => {
      if (!addresses.length || (!allowPrivate && addresses.some(({ address }) => isPrivateIP(address)))) {
        callback(new Error('连接目标解析到私有/保留网络'), '', 4);
        return;
      }
      const family = typeof options === 'number' ? options : options.family;
      const candidates = family ? addresses.filter((entry) => entry.family === Number(family)) : addresses;
      if (!candidates.length) {
        callback(new Error('没有可用的目标地址'), '', 4);
        return;
      }
      if (typeof options === 'object' && 'all' in options && options.all) {
        // Node autoSelectFamily 会请求 all=true，必须返回同一批已校验地址。
        (callback as unknown as (err: Error | null, entries: typeof candidates) => void)(null, candidates);
      } else {
        callback(null, candidates[0].address, candidates[0].family);
      }
    }).catch((error: Error) => callback(error, '', 4));
  };
}

const publicAgent = new Agent({ connect: { lookup: createSafeLookup(false) } });
const privateAgent = new Agent({ connect: { lookup: createSafeLookup(true) } });

export function upstreamDispatcher(allowPrivate: boolean): Agent {
  return allowPrivate ? privateAgent : publicAgent;
}

type ConnectOptions = Parameters<Client['connect']>[0];
type ConnectCallback = (error: Error | null, data: Dispatcher.ConnectData) => void;

class PinnedProxyClient extends Client {
  constructor(origin: URL, options: Client.Options, private readonly address: string) { super(origin, options); }
  override connect(options: ConnectOptions): Promise<Dispatcher.ConnectData>;
  override connect(options: ConnectOptions, callback: ConnectCallback): void;
  override connect(options: ConnectOptions, callback?: ConnectCallback): Promise<Dispatcher.ConnectData> | void {
    const pinned = { ...options, path: `${this.address}:443` };
    if (callback) return super.connect(pinned, callback);
    return super.connect(pinned);
  }
}

const proxyAgents = new Map<string, { proxy: string; address: string; agent: ProxyAgent }>();

/** CONNECT uses a validated literal IP; Host, TLS SNI and certificate checks retain the original hostname. */
export async function upstreamRequest(url: string, allowPrivate: boolean): Promise<{
  url: string; dispatcher: Agent | ProxyAgent;
}> {
  if (!usesBangumiEgress(url)) return { url, dispatcher: upstreamDispatcher(allowPrivate) };
  const target = new URL(url);
  const addresses = await lookupUpstreamHost(target.hostname);
  if (!addresses.length || addresses.some(({ address }) => isPrivateIP(address))) throw new Error('新番连接目标不是公网地址');
  const route = bangumiEgress()!;
  let entry = proxyAgents.get(target.hostname);
  const address = addresses[0].address;
  if (!entry || entry.proxy !== route.proxy || entry.address !== address) {
    if (entry) void entry.agent.close();
    entry = { proxy: route.proxy, address, agent: new ProxyAgent({
      uri: route.proxy,
      requestTls: { servername: target.hostname, rejectUnauthorized: true },
      clientFactory: (origin, options) => new PinnedProxyClient(origin, options, address),
    }) };
    proxyAgents.set(target.hostname, entry);
  }
  return { url, dispatcher: entry.agent };
}
