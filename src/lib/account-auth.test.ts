import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GET as listUsers, POST as manualCreateUser, PATCH as updateUser } from '@/app/api/admin/users/route';
import { POST as revealPassword } from '@/app/api/admin/users/password/route';
import { GET as accountDetail } from '@/app/api/admin/users/detail/route';
import { POST as login, DELETE as logout } from '@/app/api/auth/route';
import { GET as status } from '@/app/api/status/route';
import { POST as frameworkEndpoint } from '@/app/api/auth/[...account]/route';
import { guardRequest } from './api-guard';
import { ADMIN_SESSION_COOKIE, signAdminSession } from './admin-auth';
import { SESSION_COOKIE, signSession, signMediaURL, verifyMediaURL } from './auth';
import { getAccountAuth } from './account-auth';
import { POST as register } from '@/app/api/account/register/route';
import { generateLicenses } from './account-licenses';
import { POST as activity } from '@/app/api/user/activity/route';
import { POST as syncData } from '@/app/api/user/sync/route';

let directory: string;
let adminCookie: string;
const password = 'Test-password-12345';
const url = 'http://localhost:8080';
function request(route: string, method = 'GET', body?: unknown, cookie?: string, origin = url) {
  return new Request(url + route, { method, headers: { 'content-type': 'application/json', 'x-luna-device-id': '11111111-1111-4111-8111-111111111111', origin, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
// Existing account feature checks now obtain users through authorization-code registration.
async function createUser(req: Request) {
  const denied = await manualCreateUser(req.clone());
  if (denied.status !== 410) return denied;
  const body = await req.json(); const { database } = await getAccountAuth();
  const [code] = generateLicenses(database, { count: 1, days: 30, redeemBefore: Date.now() + 86400_000 });
  return register(request('/api/account/register', 'POST', { ...body, code: code.code }));
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
beforeEach(() => { adminCookie = `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`; });
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
  it('凭授权码注册保留登录哈希与加密副本，重复账号被拒绝', async () => {
    const created = await createUser(request('/api/admin/users', 'POST', { username: 'friend', name: '亲友', password }, adminCookie));
    expect(created.status).toBe(200);
    const { database } = await getAccountAuth();
    const credential = database.prepare('SELECT password FROM account').get() as { password: string };
    expect(credential.password).not.toBe(password);
    expect(credential.password.length).toBeGreaterThan(64);
    const encrypted = database.prepare('SELECT * FROM managed_password').get();
    expect(JSON.stringify(encrypted)).not.toContain(password);
    expect((await fs.stat(path.join(directory, '.account-password.key'))).mode & 0o777).toBe(0o600);
    const revealed = await revealPassword(request('/api/admin/users/password', 'POST', { userId: (encrypted as { userId: string }).userId }, adminCookie));
    expect(revealed.status).toBe(200);
    expect(revealed.headers.get('cache-control')).toContain('no-store');
    expect(revealed.headers.get('pragma')).toBe('no-cache');
    expect((await revealed.json()).password).toBe(password);
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
    expect((await revealPassword(request('/api/admin/users/password', 'POST', { userId: state.user.id }, cookie))).status).toBe(401);
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
    const shown = await revealPassword(request('/api/admin/users/password', 'POST', { userId }, adminCookie));
    expect((await shown.json()).password).toBe('Changed-password-12345');
    const listed = await (await listUsers(request('/api/admin/users', 'GET', undefined, adminCookie))).json();
    expect(listed.users.find((user: { id: string }) => user.id === userId).passwordAvailable).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('Changed-password-12345');
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
    expect(current.user).toMatchObject({ username: 'ShortPassFriend', name: '短密码测试' });
    expect((await logout(request('/api/auth', 'DELETE', undefined, cookie))).status).toBe(200);
  });
  it('账号详情只允许独立管理员会话读取，响应禁止缓存，参数错误不泄露数据库信息', async () => {
    const { database } = await getAccountAuth();
    const { id } = database.prepare("SELECT id FROM user WHERE username='ShortPassFriend'").get() as { id: string };
    const route = '/api/admin/users/detail?userId=' + encodeURIComponent(id);
    expect((await accountDetail(request(route))).status).toBe(401);
    expect((await accountDetail(request(route, 'GET', undefined, `${SESSION_COOKIE}=${signSession().token}`))).status).toBe(401);
    const viewerRequest = request('/api/auth', 'POST', { username: 'ShortPassFriend', password: 'six123' });
    viewerRequest.headers.set('x-forwarded-for', '192.0.2.90');
    viewerRequest.headers.set('user-agent', 'Luna12TV/2.16.18 (iOS 27.0; iPhone19,2)');
    const viewer = await login(viewerRequest);
    expect(viewer.status).toBe(200);
    expect((await accountDetail(request(route, 'GET', undefined, cookies(viewer)))).status).toBe(401);
    const response = await accountDetail(request(route, 'GET', undefined, adminCookie));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const data = await response.json();
    expect(data.user.username).toBe('ShortPassFriend');
    const deviceResponse = await accountDetail(request(route + '&section=sessions', 'GET', undefined, adminCookie));
    const deviceData = await deviceResponse.json();
    expect(deviceData.sessions.some((session: { userAgent: string }) => session.userAgent === 'Luna12TV/2.16.18 (iOS 27.0; iPhone19,2)')).toBe(true);
    expect(JSON.stringify(data)).not.toContain('six123');
    expect((await accountDetail(request(route + '&section=invalid', 'GET', undefined, adminCookie))).status).toBe(400);
    expect((await accountDetail(request('/api/admin/users/detail?userId=missing', 'GET', undefined, adminCookie))).status).toBe(404);
  });
  it('连续尝试登录会限流', async () => {
    let limited = false;
    for (let i = 0; i < 11; i++) {
      if ((await signIn('friend', 'invalid-password')).status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
  it('查看密码拒绝匿名、旧会话、跨站和非 JSON 请求，不泄露密码', async () => {
    const { database } = await getAccountAuth();
    const { id: userId } = database.prepare('SELECT id FROM user LIMIT 1').get() as { id: string };
    const body = { userId };
    expect((await revealPassword(request('/api/admin/users/password', 'POST', body))).status).toBe(401);
    expect((await revealPassword(request('/api/admin/users/password', 'POST', body, `${SESSION_COOKIE}=${signSession().token}`))).status).toBe(401);
    expect((await revealPassword(request('/api/admin/users/password', 'POST', body, adminCookie, 'https://other.example'))).status).toBe(403);
    const wrongType = request('/api/admin/users/password', 'POST', body, adminCookie);
    wrongType.headers.set('content-type', 'text/plain');
    expect((await revealPassword(wrongType)).status).toBe(415);
    const crossSite = request('/api/admin/users/password', 'POST', body, adminCookie);
    crossSite.headers.set('sec-fetch-site', 'cross-site');
    expect((await revealPassword(crossSite)).status).toBe(403);
    expect((await revealPassword(request('/api/admin/users/password', 'POST', {}, adminCookie))).status).toBe(400);
    expect((await revealPassword(request('/api/admin/users/password', 'POST', { userId: 'missing' }, adminCookie))).status).toBe(404);
  });
  it('旧账号不推断原密码；重置后可查看；加密记录写入失败时重置完整回滚', async () => {
    const { auth, database } = await getAccountAuth();
    const legacy = await auth.api.createUser({ body: { email: 'legacy@accounts.invalid', password: 'legacy-password', name: '旧账号', role: 'user', data: { username: 'legacy', displayUsername: 'legacy' } } });
    const userId = legacy.user.id;
    const list = await (await listUsers(request('/api/admin/users', 'GET', undefined, adminCookie))).json();
    expect(list.users.find((user: { id: string }) => user.id === userId).passwordAvailable).toBe(false);
    expect((await revealPassword(request('/api/admin/users/password', 'POST', { userId }, adminCookie))).status).toBe(409);
    const reset = (value: string) => updateUser(request('/api/admin/users', 'PATCH', { userId, action: 'reset-password', password: value }, adminCookie));
    expect((await reset('reset-visible-password')).status).toBe(200);
    const oldHash = (database.prepare('SELECT password FROM account WHERE userId=?').get(userId) as { password: string }).password;
    database.exec("CREATE TRIGGER fail_vault BEFORE INSERT ON managed_password BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
    try { expect((await reset('should-not-be-saved')).status).toBe(500); }
    finally { database.exec('DROP TRIGGER fail_vault'); }
    expect((database.prepare('SELECT password FROM account WHERE userId=?').get(userId) as { password: string }).password).toBe(oldHash);
    expect((await (await revealPassword(request('/api/admin/users/password', 'POST', { userId }, adminCookie))).json()).password).toBe('reset-visible-password');
  });

  it('最后登录时间只由成功登录更新，失败登录、读取会话和退出不会改写或清除', async () => {
    const username = 'LoginTimeTest';
    expect((await createUser(request('/api/admin/users', 'POST', { username, password }, adminCookie))).status).toBe(200);
    const { database } = await getAccountAuth();
    const { id } = database.prepare('SELECT id FROM user WHERE username=?').get(username) as { id: string };
    const detailRoute = '/api/admin/users/detail?userId=' + encodeURIComponent(id);
    const lastLogin = async () => (await (await accountDetail(request(detailRoute, 'GET', undefined, adminCookie))).json()).lastLoginAt;
    expect(await lastLogin()).toBeNull();
    const signInAccount = (pass: string) => {
      const input = request('/api/auth', 'POST', { username, password: pass });
      input.headers.set('x-forwarded-for', '192.0.2.195');
      return login(input);
    };
    expect((await signInAccount('wrong-password')).ok).toBe(false);
    expect(await lastLogin()).toBeNull();
    const response = await signInAccount(password);
    expect(response.status).toBe(200);
    const loggedAt = await lastLogin();
    expect(loggedAt).toBeGreaterThan(Date.now() - 10000);
    const cookie = cookies(response);
    expect((await status(request('/api/status', 'GET', undefined, cookie))).status).toBe(200);
    expect(await lastLogin()).toBe(loggedAt);
    expect((await logout(request('/api/auth', 'DELETE', undefined, cookie))).status).toBe(200);
    expect(await lastLogin()).toBe(loggedAt);
    expect(database.prepare('SELECT id FROM session WHERE userId=?').all(id)).toHaveLength(0);
    database.prepare('UPDATE account_login_state SET lastLoginAt=1 WHERE userId=?').run(id);
    expect((await signInAccount(password)).status).toBe(200);
    expect(await lastLogin()).toBeGreaterThan(1);
  });

  it('活动上报需要有效账号会话且拒绝跨站、冒用账号，停用后离线并保留时长', async () => {
    const username = 'ActivityTest';
    expect((await createUser(request('/api/admin/users', 'POST', { username, password }, adminCookie))).status).toBe(200);
    const { database } = await getAccountAuth();
    const { id } = database.prepare('SELECT id FROM user WHERE username=?').get(username) as { id: string };
    const loginRequest = request('/api/auth', 'POST', { username, password });
    loginRequest.headers.set('x-forwarded-for', '192.0.2.196');
    const cookie = cookies(await login(loginRequest));
    const body = { accountId: id, producerId: 'producer-api-123456', sequence: 1, watchedMs: 0, state: 'online' };
    expect((await activity(request('/api/user/activity', 'POST', body))).status).toBe(401);
    expect((await activity(request('/api/user/activity', 'POST', body, cookie, 'https://other.example'))).status).toBe(403);
    expect((await activity(request('/api/user/activity', 'POST', { ...body, accountId: 'other' }, cookie))).status).toBe(400);
    expect((await activity(request('/api/user/activity', 'POST', { ...body, producerId: 'bad' }, cookie))).status).toBe(400);
    const response = await activity(request('/api/user/activity', 'POST', body, cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    database.prepare('UPDATE account_activity_producer SET receivedAt=? WHERE userId=?').run(Date.now() - 20000, id);
    expect((await activity(request('/api/user/activity', 'POST', { ...body, sequence: 2, watchedMs: 20000, state: 'watching' }, cookie))).status).toBe(200);
    const detail = async () => (await (await accountDetail(request('/api/admin/users/detail?userId=' + id, 'GET', undefined, adminCookie))).json()).activity;
    const watching = await detail();
    expect(watching.status).toBe('watching');
    expect(watching.totalSeconds).toBeGreaterThanOrEqual(19);
    expect((await updateUser(request('/api/admin/users', 'PATCH', { userId: id, action: 'disable' }, adminCookie))).status).toBe(200);
    expect((await activity(request('/api/user/activity', 'POST', body, cookie))).status).toBe(401);
    const offline = await detail();
    expect(offline.status).toBe('offline');
    expect(offline.totalSeconds).toBe(watching.totalSeconds);
  });

});
