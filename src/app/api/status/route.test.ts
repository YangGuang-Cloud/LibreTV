import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

afterEach(() => vi.unstubAllEnvs());
describe('状态接口配置隔离', () => {
  it('匿名请求不下发点播源、直播源和订阅地址', async () => {
    vi.stubEnv('PASSWORD', 'test');
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '私密源', url: 'https://example.com/api?token=secret' }]));
    vi.stubEnv('DEFAULT_LIVE_SOURCES', JSON.stringify([{ name: '直播', url: 'https://example.com/list.m3u' }]));
    vi.stubEnv('DEFAULT_SUBSCRIPTIONS', '["https://example.com/private.json"]');
    const res = await GET(new Request('https://local.test/api/status'));
    expect(await res.json()).toMatchObject({ verified: false, defaultSources: [], defaultLiveSources: [], defaultSubscriptions: [] });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('有效登录后下发配置；畸形 cookie 视为匿名', async () => {
    vi.stubEnv('PASSWORD', 'test');
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '源', url: 'https://example.com/api' }]));
    const res = await GET(new Request('https://local.test/api/status', { headers: { cookie: `${SESSION_COOKIE}=${signSession().token}` } }));
    expect((await res.json()).defaultSources).toHaveLength(1);
    const malformed = await GET(new Request('https://local.test/api/status', { headers: { cookie: `${SESSION_COOKIE}=%` } }));
    expect((await malformed.json()).verified).toBe(false);
  });
});
