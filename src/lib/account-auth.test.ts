import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GET as listUsers, POST as createUser, PATCH as updateUser } from '@/app/api/admin/users/route';
import { POST as login, DELETE as logout } from '@/app/api/auth/route';
import { GET as status } from '@/app/api/status/route';
import { POST as frameworkEndpoint } from '@/app/api/auth/[...account]/route';
import { guardRequest } from './api-guard';
import { ADMIN_SESSION_COOKIE, signAdminSession } from './admin-auth';
import { SESSION_COOKIE, signSession, signMediaURL, verifyMediaURL } from './auth';
import { getAccountAuth } from './account-auth';
import { POST as syncData } from '@/app/api/user/sync/route';

let directory: string;
let adminCookie: string;
const password = 'Test-password-12345';
const url = 'http://localhost:8080';
function request(route: string, method = 'GET', body?: unknown, cookie?: string, origin = url) {
  return new Request(url + route, { method, headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function cookies(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}
async function signIn(name = 'friend', pass = password) {
  return login(request('/api/auth', 'POST', { username: name, password: pass }));
}

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-accounts-'));
  vi.stubEnv('AUTH_MODE', 'account'); vi.stubEnv('BETTER_AUTH_URL', url);
  vi.stubEnv('BETTER_AUTH_SECRET', 'integration-test-secret-at-least-32-characters');
  vi.stubEnv('SERVER_DATA_DIR', directory); vi.stubEnv('ADMIN_PASSWORD', 'admin-password'); vi.stubEnv('PASSWORD', 'legacy-password');
  adminCookie = `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`;
});
afterAll(async () => {
  const state = await getAccountAuth();
  state.database.close();
  delete (globalThis as typeof globalThis & { lunaAccounts?: unknown }).lunaAccounts;
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe.sequential('真实 SQLite 账号闭环', () => {
  it('匿名和旧观看 cookie 不能创建用户或通过播放鉴权', async () => {
    expect((await createUser(request('/api/admin/users', 'POST', { username: 'friend', password }))).status).toBe(401);
    const old = `${SESSION_COOKIE}=${signSession().token}`;
    expect((await guardRequest(request('/api/search', 'GET', undefined, old)))?.status).toBe(401);
    expect((await createUser(request('/api/admin/users', 'POST', { username: 'friend', password }, old))).status).toBe(401);
  });
  it('注册和框架管理员接口都关闭，跨站后台操作被拒绝', async () => {
    for (const route of ['/sign-up/email', '/admin/create-user', '/sign-in/email', '/update-user']) {
      expect((await frameworkEndpoint(request('/api/auth' + route, 'POST', { email: 'x@example.com', password }))).status).toBe(404);
    }
    expect((await createUser(request('/api/admin/users', 'POST', { username: 'friend', password }, adminCookie, 'https://other.example'))).status).toBe(403);
  });
  it('管理员可以创建账号，密码只以哈希存储，重复账号被拒绝', async () => {
    const created = await createUser(request('/api/admin/users', 'POST', { username: 'Friend', name: '亲友', password }, adminCookie));
    expect(created.status).toBe(200);
    const { database } = await getAccountAuth();
    const credential = database.prepare('SELECT password FROM account').get() as { password: string };
    expect(credential.password).not.toBe(password);
    expect(credential.password.length).toBeGreaterThan(64);
    expect((await fs.stat(path.join(directory, 'accounts.sqlite'))).mode & 0o777).toBe(0o600);
    expect((await createUser(request('/api/admin/users', 'POST', { username: 'friend', password }, adminCookie))).status).toBe(409);
  });
  it('账号可登录、取得独立身份和观看权限，但无后台权限；错误密码不可登录', async () => {
    expect((await signIn('friend', 'wrong-password')).ok).toBe(false);
    const response = await signIn();
    expect(response.status).toBe(200);
    const cookie = cookies(response);
    expect(cookie).toContain('session_token=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const state = await (await status(request('/api/status', 'GET', undefined, cookie))).json();
    expect(state).toMatchObject({ authMode: 'account', verified: true, user: { username: 'friend', name: '亲友' } });
    expect(await guardRequest(request('/api/search', 'GET', undefined, cookie))).toBeNull();
    expect((await listUsers(request('/api/admin/users', 'GET', undefined, cookie))).status).toBe(401);
  });
  it('停用立即撤销会话且不能重新登录，启用后恢复登录', async () => {
    const cookie = cookies(await signIn());
    const data = await (await listUsers(request('/api/admin/users', 'GET', undefined, adminCookie))).json();
    expect(data.users[0]).not.toHaveProperty('password');
    const userId = data.users[0].id;
    expect((await updateUser(request('/api/admin/users', 'PATCH', { userId, action: 'disable' }, adminCookie))).status).toBe(200);
    expect((await guardRequest(request('/api/search', 'GET', undefined, cookie)))?.status).toBe(401);
    expect((await signIn()).ok).toBe(false);
    expect((await updateUser(request('/api/admin/users', 'PATCH', { userId, action: 'enable' }, adminCookie))).status).toBe(200);
    expect((await signIn()).status).toBe(200);
  });
  it('管理员重置密码立即撤销会话，旧密码失效；用户可以修改自己的密码', async () => {
    const cookie = cookies(await signIn());
    const { database } = await getAccountAuth();
    const { id: userId } = database.prepare('SELECT id FROM user LIMIT 1').get() as { id: string };
    const nextPassword = 'New-password-12345';
    expect((await updateUser(request('/api/admin/users', 'PATCH', { userId, action: 'reset-password', password: nextPassword }, adminCookie))).status).toBe(200);
    expect((await guardRequest(request('/api/search', 'GET', undefined, cookie)))?.status).toBe(401);
    expect((await signIn()).ok).toBe(false);
    const newCookie = cookies(await signIn('friend', nextPassword));
    expect(await guardRequest(request('/api/search', 'GET', undefined, newCookie))).toBeNull();
    const changed = await frameworkEndpoint(request('/api/auth/change-password', 'POST', { currentPassword: nextPassword, newPassword: 'Changed-password-12345', revokeOtherSessions: true }, newCookie));
    expect(changed.status).toBe(200);
  });
  it('退出会撤销服务端会话，重放旧 cookie 无效', async () => {
    const cookie = cookies(await signIn('friend', 'Changed-password-12345'));
    expect((await logout(request('/api/auth', 'DELETE', undefined, cookie))).status).toBe(200);
    expect((await guardRequest(request('/api/search', 'GET', undefined, cookie)))?.status).toBe(401);
  });
  it('账号模式无需旧 PASSWORD，投屏签名仍然有效；跨站登录被拒绝', async () => {
    vi.stubEnv('PASSWORD', '');
    expect((await (await status(request('/api/status'))).json()).passwordRequired).toBe(true);
    const expires = Date.now() + 60_000;
    const target = 'https://example.com/video.m3u8';
    expect(verifyMediaURL(target, String(expires), signMediaURL(target, expires))).toBe(true);
    expect((await login(request('/api/auth', 'POST', { username: 'friend', password }, undefined, 'https://other.example'))).status).toBe(403);
  });
  it('同步接口从登录会话确定身份，拒绝匿名、跨站和冒用其他账号', async () => {
    const { database } = await getAccountAuth();
    const { id } = database.prepare('SELECT id FROM user LIMIT 1').get() as { id: string };
    const body = { protocol: 1, accountId: id, cursor: 0, mutations: [] };
    expect((await syncData(request('/api/user/sync', 'POST', body))).status).toBe(401);
    const cookie = cookies(await signIn('friend', 'Changed-password-12345'));
    expect((await syncData(request('/api/user/sync', 'POST', body, cookie))).status).toBe(200);
    expect((await syncData(request('/api/user/sync', 'POST', { ...body, accountId: 'someone-else' }, cookie))).status).toBe(409);
    expect((await syncData(request('/api/user/sync', 'POST', body, cookie, 'https://other.example'))).status).toBe(403);
    expect((await syncData(request('/api/user/sync', 'POST', { ...body, mutations: [{ id: 'x', collection: 'preference', key: 'role', value: 'admin', baseVersion: 0 }] }, cookie))).status).toBe(400);
  });
  it('支持六位测试密码，拒绝更短密码，账号名忽略大小写', async () => {
    const adminCookie = `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`;
    expect((await createUser(request('/api/admin/users', 'POST', { username: 'too_short', password: '12345' }, adminCookie))).status).toBe(400);
    expect((await createUser(request('/api/admin/users', 'POST', { username: 'ShortPassFriend', name: '短密码测试', password: 'six123' }, adminCookie))).status).toBe(200);
    const loginRequest = request('/api/auth', 'POST', { username: 'ShortPassFriend', password: 'six123' });
    loginRequest.headers.set('x-forwarded-for', '192.0.2.60');
    const response = await login(loginRequest);
    expect(response.status).toBe(200);
    const cookie = cookies(response);
    const current = await (await status(request('/api/status', 'GET', undefined, cookie))).json();
    expect(current.user).toMatchObject({ username: 'shortpassfriend', name: '短密码测试' });
    expect((await logout(request('/api/auth', 'DELETE', undefined, cookie))).status).toBe(200);
  });
  it('连续尝试登录会限流', async () => {
    let limited = false;
    for (let i = 0; i < 11; i++) {
      if ((await signIn('friend', 'invalid-password')).status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});
