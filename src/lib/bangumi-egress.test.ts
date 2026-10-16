import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), resolve4: vi.fn(), setServers: vi.fn(), proxy: vi.fn(), close: vi.fn(), connect: vi.fn() }));
vi.mock('node:dns/promises', () => ({ default: {
  lookup: mocks.lookup,
  Resolver: vi.fn().mockImplementation(() => ({ resolve4: mocks.resolve4, setServers: mocks.setServers })),
} }));
vi.mock('undici', () => ({
  Agent: vi.fn().mockImplementation(() => ({})),
  Client: class { connect(...args: unknown[]) { return mocks.connect(...args); } },
  ProxyAgent: vi.fn().mockImplementation((options) => { mocks.proxy(options); return { close: mocks.close }; }),
}));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('BANGUMI_HTTP_PROXY', 'http://viewer:example@127.0.0.1:18089');
  vi.stubEnv('BANGUMI_DNS_SERVER', '127.0.0.1:18053');
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  mocks.resolve4.mockResolvedValue([{ address: '1.1.1.1', ttl: 60 }]);
  mocks.close.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Bangumi 专用出站', () => {
  it('仅允许指定 HTTPS 日历和封面路径，不放行伪装域名、凭据、端口或其他 API', async () => {
    const { usesBangumiEgress } = await import('./bangumi-egress');
    for (const url of ['https://api.bgm.tv/calendar', 'https://lain.bgm.tv/pic/cover/l/a.jpg', 'https://lain.bgm.tv/r/400/pic/cover/l/a.jpg']) expect(usesBangumiEgress(url)).toBe(true);
    for (const url of ['http://api.bgm.tv/calendar', 'https://api.bgm.tv:8443/calendar', 'https://user@api.bgm.tv/calendar', 'https://api.bgm.tv.evil.test/calendar', 'https://api.bgm.tv/v0/me', 'https://lain.bgm.tv/secret', 'https://127.0.0.1/calendar']) expect(usesBangumiEgress(url)).toBe(false);
  });

  it('未配置时沿用系统解析和原有直连，其他网站始终直连', async () => {
    const { upstreamRequest } = await import('./upstream-dispatcher');
    const { lookupUpstreamHost } = await import('./bangumi-egress');
    expect((await upstreamRequest('https://movie.douban.com/a', false)).url).toBe('https://movie.douban.com/a');
    vi.stubEnv('BANGUMI_HTTP_PROXY', ''); vi.stubEnv('BANGUMI_DNS_SERVER', '');
    expect(await lookupUpstreamHost('api.bgm.tv')).toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect((await upstreamRequest('https://api.bgm.tv/calendar', false)).url).toBe('https://api.bgm.tv/calendar');
    expect(mocks.proxy).not.toHaveBeenCalled(); expect(mocks.resolve4).not.toHaveBeenCalled();
  });

  it('解析经本机 VPN DNS，预检与连接共享结果；CONNECT 固定公网 IP 并保留 Host/SNI 和证书校验', async () => {
    const { checkUpstreamAllowed } = await import('./ssrf');
    const { upstreamRequest } = await import('./upstream-dispatcher');
    expect(await checkUpstreamAllowed('https://api.bgm.tv/calendar')).toEqual({ ok: true });
    const route = await upstreamRequest('https://api.bgm.tv/calendar?x=1', false);
    expect(route.url).toBe('https://api.bgm.tv/calendar?x=1');
    expect(mocks.resolve4).toHaveBeenCalledTimes(1); expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.setServers).toHaveBeenCalledWith(['127.0.0.1:18053']);
    expect(mocks.proxy).toHaveBeenCalledWith(expect.objectContaining({ requestTls: { servername: 'api.bgm.tv', rejectUnauthorized: true } }));
    const options = mocks.proxy.mock.calls[0][0];
    const client = options.clientFactory(new URL('http://127.0.0.1:18089'), {});
    client.connect({ path: 'api.bgm.tv:443' });
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ path: '1.1.1.1:443' }));
  });

  it('VPN DNS 返回内网或混合地址时拒绝创建连接，私网直播开关也不放宽这条线路', async () => {
    mocks.resolve4.mockResolvedValue([{ address: '8.8.8.8', ttl: 30 }, { address: '127.0.0.1', ttl: 30 }]);
    const { isBlockedByDNS } = await import('./ssrf');
    const { upstreamRequest } = await import('./upstream-dispatcher');
    expect(await isBlockedByDNS('https://api.bgm.tv/calendar')).toBe(true);
    await expect(upstreamRequest('https://api.bgm.tv/calendar', true)).rejects.toThrow('不是公网地址');
    expect(mocks.proxy).not.toHaveBeenCalled();
  });

  it('配置缺失一半或代理不在本机时明确失败，不回退到其他出站线路', async () => {
    const { bangumiEgress } = await import('./bangumi-egress');
    vi.stubEnv('BANGUMI_DNS_SERVER', ''); expect(() => bangumiEgress()).toThrow('出站配置无效');
    vi.stubEnv('BANGUMI_DNS_SERVER', '127.0.0.1:18053');
    vi.stubEnv('BANGUMI_HTTP_PROXY', 'http://8.8.8.8:8080'); expect(() => bangumiEgress()).toThrow('出站配置无效');
  });

  it('每一跳都重新校验；通过 VPN 的公网图片不能重定向到内网', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }));
    vi.stubGlobal('fetch', fetch);
    const { fetchUpstreamWithMeta } = await import('./fetch-utils');
    await expect(fetchUpstreamWithMeta('https://lain.bgm.tv/pic/cover/l/a.jpg')).rejects.toThrow('跳转目标被拒绝');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://lain.bgm.tv/pic/cover/l/a.jpg');
  });
});
