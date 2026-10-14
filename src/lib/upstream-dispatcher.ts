import dns from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { isPrivateIP } from './ssrf';

/** 校验用于实际 socket 连接的同一批 DNS 结果，防止预检后 DNS 重绑定。 */
export function createSafeLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    void dns.lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
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
