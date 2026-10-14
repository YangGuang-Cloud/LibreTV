import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSafeLookup } from './upstream-dispatcher';
import { isBlockedByDNS } from './ssrf';

vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn() } }));
const lookup = vi.mocked(dns.lookup);
afterEach(() => vi.resetAllMocks());

function connect(allowPrivate = false): Promise<string> {
  return new Promise((resolve, reject) => createSafeLookup(allowPrivate)('rebind.example', {}, (error, address) => {
    if (error) reject(error); else resolve(address as string);
  }));
}

describe('实际连接地址校验', () => {
  it('预检公网后 DNS 重绑定到内网，socket 连接被拒绝', async () => {
    lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as never);
    expect(await isBlockedByDNS('https://rebind.example/')).toBe(false);
    lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(connect()).rejects.toThrow('私有/保留网络');
  });
  it('混合公网和内网 DNS 结果整体拒绝', async () => {
    lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }] as never);
    await expect(connect()).rejects.toThrow('私有/保留网络');
  });
  it('解析失败或空结果不放行', async () => {
    lookup.mockRejectedValue(new Error('DNS failed'));
    expect(await isBlockedByDNS('https://unknown.example/')).toBe(true);
    await expect(connect()).rejects.toThrow('DNS failed');
    lookup.mockResolvedValue([] as never);
    await expect(connect()).rejects.toThrow();
  });
  it('连接使用已校验的公网结果；显式内网连接仅由私网 dispatcher 支持', async () => {
    lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    expect(await connect()).toBe('8.8.8.8');
    lookup.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as never);
    expect(await connect(true)).toBe('192.168.1.1');
  });
  it('autoSelectFamily 返回全部已校验地址，不另做 DNS 解析', async () => {
    const addresses = [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700::1111', family: 6 }];
    lookup.mockResolvedValue(addresses as never);
    const result = await new Promise<LookupAddress[]>((resolve, reject) => {
      createSafeLookup(false)('public.example', { all: true } as never, ((error: Error | null, entries: LookupAddress[]) => {
        if (error) reject(error); else resolve(entries);
      }) as never);
    });
    expect(result).toEqual(addresses);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
