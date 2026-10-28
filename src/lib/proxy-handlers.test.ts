import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleProxyRequest } from './proxy-handlers';
import { SESSION_COOKIE, signSession, signMediaURL } from './auth';
import { mediaSessionAllowed } from './account-media-session';
import { fetchWithSafeRedirects } from './fetch-utils';

vi.mock('./account-auth', () => ({ getAccountSession: vi.fn(async () => null) }));
vi.mock('./account-media-session', () => ({ mediaSessionAllowed: vi.fn() }));
vi.mock('./fetch-utils', () => ({ fetchWithSafeRedirects: vi.fn() }));
vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) } }));
beforeEach(() => vi.stubEnv('PASSWORD', 'test'));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

function req(auth = true) {
  return new Request('https://local.test/api/proxy', { headers: auth ? { cookie: `${SESSION_COOKIE}=${signSession().token}` } : {} });
}
describe('代理鉴权与缓存', () => {
  it('鉴权视频分片、密钥和图片不进入公共缓存', async () => {
    for (const contentType of ['video/mp2t', 'application/octet-stream', 'image/jpeg']) {
      vi.mocked(fetchWithSafeRedirects).mockResolvedValue({ res: new Response('data', { headers: { 'content-type': contentType } }), finalUrl: 'https://8.8.8.8/data' });
      const res = await handleProxyRequest(req(), 'https://8.8.8.8/data');
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
  });
  it('带查询参数、错误 MIME 的 m3u8 仍正确重写分片', async () => {
    const url = 'https://8.8.8.8/video/index.m3u8?token=abc';
    vi.mocked(fetchWithSafeRedirects).mockResolvedValue({ res: new Response('#EXTM3U\n#EXTINF:6,\nseg.ts\n', { headers: { 'content-type': 'text/plain' } }), finalUrl: url });
    const res = await handleProxyRequest(req(), url);
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(await res.text()).toContain('/api/proxy?url=');
  });
  it('匿名图片白名单不能通过重定向变成开放代理', async () => {
    vi.mocked(fetchWithSafeRedirects).mockResolvedValue({ res: new Response('secret', { headers: { 'content-type': 'image/jpeg' } }), finalUrl: 'https://8.8.8.8/secret' });
    expect((await handleProxyRequest(req(false), 'https://img.doubanio.com/cover.jpg')).status).toBe(401);
  });
  it('仅匿名白名单的成功图片可以公共缓存，JSON 不能', async () => {
    const url = 'https://img.doubanio.com/cover.jpg';
    vi.mocked(fetchWithSafeRedirects).mockResolvedValue({ res: new Response('image', { headers: { 'content-type': 'image/jpeg' } }), finalUrl: url });
    expect((await handleProxyRequest(req(false), url)).headers.get('cache-control')).toContain('public');
    vi.mocked(fetchWithSafeRedirects).mockResolvedValue({ res: new Response('{}', { headers: { 'content-type': 'application/json' } }), finalUrl: url });
    expect((await handleProxyRequest(req(false), url)).status).toBe(401);
  });
});

it('账号模式投屏签名绑定会话，分片沿用绑定，解绑后旧链接不能继续请求', async () => {
  vi.stubEnv('AUTH_MODE','account'); vi.stubEnv('BETTER_AUTH_URL','https://local.test'); vi.stubEnv('BETTER_AUTH_SECRET','test-secret-with-at-least-32-characters');
  const target='https://8.8.8.8/list.m3u8', session='bound-session-123', expires=Date.now()+60000;
  const url=`https://local.test/api/proxy?mediaExpires=${expires}&mediaSession=${session}&mediaSignature=${signMediaURL(target,expires,session)}`;
  vi.mocked(mediaSessionAllowed).mockResolvedValue(true);
  vi.mocked(fetchWithSafeRedirects).mockResolvedValue({res:new Response('#EXTM3U\n#EXTINF:5,\nseg.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}}),finalUrl:target});
  const response=await handleProxyRequest(new Request(url),target);expect(response.status).toBe(200);
  const text=await response.text();expect(text).toContain(`mediaSession=${session}`);expect(text).toContain(signMediaURL('https://8.8.8.8/seg.ts',expires,session));
  vi.mocked(mediaSessionAllowed).mockResolvedValue(false);vi.mocked(fetchWithSafeRedirects).mockClear();
  expect((await handleProxyRequest(new Request(url),target)).status).toBe(401);expect(fetchWithSafeRedirects).not.toHaveBeenCalled();
});
