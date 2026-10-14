import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from './route';
import { ADMIN_SESSION_COOKIE, adminSessionFromRequest, signAdminSession, verifyAdminSession } from '@/lib/admin-auth';
import { clearRateLimit, SESSION_COOKIE, signSession, verifySession } from '@/lib/auth';
import { guardAdminRequest } from '@/lib/admin-guard';

beforeEach(() => { vi.stubEnv('PASSWORD', 'viewer'); vi.stubEnv('ADMIN_PASSWORD', 'admin'); clearRateLimit('admin:127.0.0.2'); });
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
