import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from './route';
import { ADMIN_SESSION_COOKIE, ADMIN_REMEMBER_MS, adminSessionFromRequest, signAdminSession, verifyAdminSession } from '@/lib/admin-auth';
import { clearRateLimit, SESSION_COOKIE, signSession, verifySession } from '@/lib/auth';
import { guardAdminRequest } from '@/lib/admin-guard';

beforeEach(() => { vi.stubEnv('ADMIN_USERNAME', ''); vi.stubEnv('BETTER_AUTH_URL', ''); vi.stubEnv('PASSWORD', 'viewer'); vi.stubEnv('ADMIN_PASSWORD', 'admin'); clearRateLimit('admin:127.0.0.2'); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
function req(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request('https://local.test/api/admin/auth', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '127.0.0.2', ...extraHeaders }, body: JSON.stringify(body),
  });
}
describe('独立后台登录', () => {
  it('管理员密码登录签发专用 HttpOnly、Strict、HTTPS Cookie', async () => {
    const res = await POST(req({ password: 'admin' }, { 'x-forwarded-proto': 'https' }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(ADMIN_SESSION_COOKIE + '=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=strict');
    expect(cookie).toContain('Path=/api/admin');
    const authReq = new Request('https://local.test/api/admin/auth', { headers: { cookie: cookie.split(';')[0] } });
    expect((await (await GET(authReq)).json()).verified).toBe(true);
    expect(guardAdminRequest(authReq)).toBeNull();
    expect(verifySession(cookie.split(';')[0].split('=')[1])).toBe(false);
  });
  it('观看密码、观看 cookie 和旧的明文管理密码请求头不能取得管理员权限', async () => {
    expect((await POST(req({ password: 'viewer' }))).status).toBe(401);
    const request = new Request('https://local.test/api/admin/auth', { headers: {
      cookie: `${SESSION_COOKIE}=${signSession().token}`, 'x-admin-password': 'admin',
    } });
    expect((await (await GET(request)).json()).verified).toBe(false);
    expect(guardAdminRequest(request)?.status).toBe(401);
  });
  it('后台登出只清除后台 cookie，保留观看登录', async () => {
    const res = await DELETE(new Request('https://local.test/api/admin/auth'));
    expect(res.headers.get('set-cookie')).toContain(`${ADMIN_SESSION_COOKIE}=;`);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(res.headers.get('set-cookie')).not.toContain(`${SESSION_COOKIE}=`);
  });
  it('管理员会话到期、被篡改或管理员密码改变后失效', () => {
    vi.useFakeTimers();
    const { token } = signAdminSession();
    expect(verifyAdminSession(token)).toBe(true);
    expect(verifyAdminSession(token + 'x')).toBe(false);
    vi.stubEnv('ADMIN_PASSWORD', 'changed');
    expect(verifyAdminSession(token)).toBe(false);
    vi.stubEnv('ADMIN_PASSWORD', 'admin');
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1);
    expect(verifyAdminSession(token)).toBe(false);
    expect(adminSessionFromRequest(new Request('https://local.test', { headers: { cookie: `${ADMIN_SESSION_COOKIE}=%` } }))).toBe(false);
  });
  it('连续错误登录会限流，畸形请求返回 400', async () => {
    expect((await POST(req(null))).status).toBe(400);
    for (let i = 0; i < 9; i++) expect((await POST(req({ password: 'wrong' }))).status).toBe(401);
    expect((await POST(req({ password: 'admin' }))).status).toBe(429);
  });
  it('未配置后台密码时无法登录', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect((await POST(req({ password: 'admin' }))).status).toBe(503);
    expect((await (await GET(new Request('https://local.test'))).json()).configured).toBe(false);
  });
});

it('默认记住管理员，返回真实身份并在 8 小时后仍有效，篡改记住标记无效', async () => {
  vi.useFakeTimers();
  const response = await POST(req({ username: 'admin', password: 'admin' }));
  const body = await response.json();
  expect(body).toMatchObject({ user: { username: 'admin', name: '管理员' }, remember: true });
  expect(body.expiresAt - Date.now()).toBe(ADMIN_REMEMBER_MS);
  expect(response.headers.get('set-cookie')).toContain('Max-Age=2592000');
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  expect(verifyAdminSession(token.replace('r.', ''))).toBe(false);
  vi.advanceTimersByTime(9 * 3600_000);
  expect(verifyAdminSession(token)).toBe(true);
  const status = await (await GET(new Request('https://local.test/api/admin/auth', { headers: { cookie } }))).json();
  expect(status).toMatchObject({ verified: true, user: body.user, remember: true });
  vi.advanceTimersByTime(ADMIN_REMEMBER_MS);
  expect(verifyAdminSession(token)).toBe(false);
});
it('未勾选保持登录时使用浏览器会话 Cookie，最多 8 小时且不自动续期', async () => {
  vi.useFakeTimers();
  const response = await POST(req({ username: 'admin', password: 'admin', remember: false }));
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).not.toContain('Max-Age=');
  expect(cookie).not.toContain('Expires=');
  const token = cookie.split(';')[0].split('=')[1];
  vi.advanceTimersByTime(2 * 86400_000);
  const state = await GET(new Request('https://local.test/api/admin/auth', { headers: { cookie: cookie.split(';')[0] } }));
  expect(state.headers.get('set-cookie')).toBeNull();
  expect((await state.json()).verified).toBe(false);
  expect(verifyAdminSession(token)).toBe(false);
});
it('记住登录超过一天后打开后台续期，过期会话不能续期，匿名不返回身份', async () => {
  vi.useFakeTimers();
  const { token } = signAdminSession(true);
  const request = new Request('https://local.test/api/admin/auth', { headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` } });
  expect((await GET(request)).headers.get('set-cookie')).toBeNull();
  vi.advanceTimersByTime(2 * 86400_000);
  const renewed = await GET(request);
  expect(renewed.headers.get('set-cookie')).toContain('Max-Age=2592000');
  expect((await renewed.json()).expiresAt).toBe(Date.now() + ADMIN_REMEMBER_MS);
  vi.advanceTimersByTime(ADMIN_REMEMBER_MS);
  const expired = await GET(request);
  expect(expired.headers.get('set-cookie')).toBeNull();
  expect(await expired.json()).toMatchObject({ verified: false, user: null, expiresAt: null });
});
it('校验管理员账号，支持自定义账号名，账号名或密码改变即令旧会话失效', async () => {
  expect((await POST(req({ username: 'other', password: 'admin' }))).status).toBe(401);
  vi.stubEnv('ADMIN_USERNAME', 'owner');
  expect((await POST(req({ username: 'admin', password: 'admin' }))).status).toBe(401);
  const response = await POST(req({ username: 'Owner', password: 'admin' }));
  expect(response.status).toBe(200);
  expect((await response.json()).user.username).toBe('owner');
  const token = decodeURIComponent(response.headers.get('set-cookie')!.split(';')[0].split('=')[1]);
  expect(verifyAdminSession(token)).toBe(true);
  vi.stubEnv('ADMIN_USERNAME', 'another');
  expect(verifyAdminSession(token)).toBe(false);
  vi.stubEnv('ADMIN_USERNAME', 'owner'); vi.stubEnv('ADMIN_PASSWORD', 'updated');
  expect(verifyAdminSession(token)).toBe(false);
});
it('拒绝畸形账号、记住选项和跨站登录退出，支持配置的反向代理站点地址', async () => {
  expect((await POST(req({ username: {}, password: 'admin' }))).status).toBe(400);
  expect((await POST(req({ password: 'admin', remember: 'true' }))).status).toBe(400);
  expect((await POST(req({ password: 'admin' }, { origin: 'https://foreign.test' }))).status).toBe(403);
  expect((await DELETE(new Request('https://local.test/api/admin/auth', { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } }))).status).toBe(403);
  expect((await POST(req({ password: 'admin' }, { origin: 'https://proxy.test', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'proxy.test' }))).status).toBe(200);
  vi.stubEnv('BETTER_AUTH_URL', 'https://public.test'); vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-with-at-least-32-characters');
  const response = await POST(req({ password: 'admin' }, { origin: 'https://public.test' }));
  expect(response.status).toBe(200);
});
