import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getAccountAuth } from './account-auth';
import { generateLicenses, listLicenses, redeemLicense, revokeLicense, accountAccess } from './account-licenses';
import { GET as adminLicenses } from '@/app/api/admin/licenses/route';
import { POST as register } from '@/app/api/account/register/route';
import { POST as renew } from '@/app/api/account/redeem/route';
import { POST as login } from '@/app/api/auth/route';
import { GET as status } from '@/app/api/status/route';
import { guardRequest } from './api-guard';
import { POST as manualCreate } from '@/app/api/admin/users/route';
import { ADMIN_SESSION_COOKIE, signAdminSession } from './admin-auth';
const base = 'http://localhost:8080'; let directory: string;
const req = (url: string, body?: unknown, cookie?: string) => new Request(base + url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-luna-device-id': '11111111-1111-4111-8111-111111111111', origin: base, 'x-real-ip': 'license-test', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const cookieOf = (res: Response) => res.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-codes-'));
  vi.stubEnv('AUTH_MODE', 'account'); vi.stubEnv('BETTER_AUTH_URL', base); vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-with-at-least-32-characters'); vi.stubEnv('SERVER_DATA_DIR', directory); vi.stubEnv('ADMIN_PASSWORD', 'admin-pass');
});
afterAll(async () => { (await getAccountAuth()).database.close(); delete (globalThis as typeof globalThis & { lunaAccounts?: unknown }).lunaAccounts; vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });
async function code(days = 30) { return generateLicenses((await getAccountAuth()).database, { count: 1, days, redeemBefore: Date.now() + 86400_000 })[0]; }
it('无授权码无法注册且不遗留账号，有效码绑定自行注册账号，普通账号不能后台创建账号', async () => {
  expect((await register(req('/api/account/register', { username: 'licensed', password: '123456', code: 'wrong' }))).status).toBe(400);
  const { database } = await getAccountAuth();
  expect(database.prepare('SELECT id FROM user WHERE username=?').get('licensed')).toBeUndefined();
  const issued = await code();
  expect((await register(req('/api/account/register', { username: 'licensed', password: '123456', code: issued.code }))).status).toBe(200);
  const response = await login(req('/api/auth', { username: 'licensed', password: '123456' })); expect(response.status).toBe(200);
  expect(await guardRequest(req('/api/search', undefined, cookieOf(response)))).toBeNull();
  expect((await adminLicenses(req('/api/admin/licenses'))).status).toBe(401);
  expect((await adminLicenses(req('/api/admin/licenses', undefined, cookieOf(response)))).status).toBe(401);
  const details = listLicenses(database, 0, issued.id) as Record<string, unknown>;
  expect(details).toMatchObject({ username: 'licensed', state: 'used', code: issued.code });
  expect(JSON.stringify(database.prepare('SELECT * FROM authorization_code').all())).not.toContain(issued.code);
  expect((await manualCreate(req('/api/admin/users', { username: 'x', password: '123456' }, `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`))).status).toBe(410);
});
it('同一码并发注册仅一人成功，失败者不留下账号，不能转给另一账号', async () => {
  const issued = await code();
  const results = await Promise.all(['racerOne', 'racerTwo'].map(username => register(req('/api/account/register', { username, password: '123456', code: issued.code }))));
  expect(results.map(result => result.status).sort()).toEqual([200, 400]);
  const { database } = await getAccountAuth();
  expect((database.prepare("SELECT COUNT(*) AS n FROM user WHERE username LIKE 'racer%'").get() as { n: number }).n).toBe(1);
});
it('到期后旧会话不能搜索同步或观看，登录不发 Cookie；数据仍在，新码可恢复并保留账号', async () => {
  const { database } = await getAccountAuth();
  const user = database.prepare("SELECT id FROM user WHERE username='licensed'").get() as { id: string };
  const before = await login(req('/api/auth', { username: 'licensed', password: '123456' })); const cookie = cookieOf(before);
  database.prepare('UPDATE account_authorization SET expiresAt=? WHERE userId=?').run(Date.now() - 1, user.id);
  expect((await guardRequest(req('/api/search', undefined, cookie)))?.status).toBe(401);
  expect((await (await status(req('/api/status', undefined, cookie))).json()).verified).toBe(false);
  const denied = await login(req('/api/auth', { username: 'licensed', password: '123456' })); expect(denied.status).toBe(403); expect(denied.headers.get('set-cookie')).toBeNull();
  const issued = await code();
  const renewed = await renew(req('/api/account/redeem', { username: 'licensed', password: '123456', code: issued.code })); expect(renewed.status).toBe(200);
  expect(await guardRequest(req('/api/search', undefined, cookieOf(renewed)))).toBeNull();
  expect(database.prepare("SELECT id FROM user WHERE username='licensed'").get()).toEqual(user);
});
it('提前续期从原期限累加，码有兑换期限，作废和重复兑换都不延长授权', async () => {
  const { database } = await getAccountAuth(); const { id } = database.prepare("SELECT id FROM user WHERE username='licensed'").get() as { id: string };
  const before = accountAccess(database, id).expiresAt!; const issued = await code(7);
  expect(redeemLicense(database, id, issued.code).expiresAt).toBe(before + 7 * 86400_000);
  expect(() => redeemLicense(database, id, issued.code)).toThrow();
  expect(accountAccess(database, id).expiresAt).toBe(before + 7 * 86400_000);
  const revoked = await code(); revokeLicense(database, revoked.id); expect(() => redeemLicense(database, id, revoked.code)).toThrow();
  const expired = await code(); database.prepare('UPDATE authorization_code SET redeemBefore=? WHERE id=?').run(Date.now() - 1, expired.id); expect(() => redeemLicense(database, id, expired.code)).toThrow();
  const { totals } = listLicenses(database) as { totals: Record<string, number> }; expect(totals.revoked).toBe(1); expect(totals.expired).toBe(1); expect(totals.total).toBeGreaterThan(4);
});
it('旧账号没有授权即不可用；停用账号不能通过授权码恢复，失败不消耗授权码', async () => {
  const { database } = await getAccountAuth(); const { id } = database.prepare("SELECT id FROM user WHERE username='licensed'").get() as { id: string };
  database.prepare('DELETE FROM account_authorization WHERE userId=?').run(id);
  expect(accountAccess(database, id)).toEqual({ state: 'unactivated', expiresAt: null });
  const issued = await code(); database.prepare('UPDATE user SET banned=1 WHERE id=?').run(id);
  expect(() => redeemLicense(database, id, issued.code)).toThrow();
  expect((listLicenses(database, 0, issued.id) as unknown as { state: string }).state).toBe('unused');
  database.prepare('UPDATE user SET banned=0 WHERE id=?').run(id);
});
it('跨站、错误密码续期与未经授权的注册失败，不返回密钥', async () => {
  const issued = await code(); const bad = req('/api/account/register', { username: 'crosssite', password: '123456', code: issued.code }); bad.headers.set('origin', 'https://other.example');
  expect((await register(bad)).status).toBe(403);
  expect((await renew(req('/api/account/redeem', { username: 'licensed', password: 'wrongpw', code: issued.code }))).status).toBe(401);
});
it('无限期授权支持注册与登录，拒绝重复续期且不消耗新码', async () => {
  const { database } = await getAccountAuth();
  const issued = generateLicenses(database, { count: 1, days: null, redeemBefore: null })[0];
  expect((listLicenses(database, 0, issued.id) as Record<string, unknown>).state).toBe('unused');
  expect((await register(req('/api/account/register', { username: 'foreverUser', password: '123456', code: issued.code }))).status).toBe(200);
  const { id } = database.prepare("SELECT id FROM user WHERE username='foreverUser'").get() as { id: string };
  expect(accountAccess(database, id, Date.now() + 100 * 365 * 86400_000)).toEqual({ state: 'active', expiresAt: null });
  const response = await login(req('/api/auth', { username: 'foreverUser', password: '123456' }));
  expect(response.status).toBe(200);
  expect(await guardRequest(req('/api/search', undefined, cookieOf(response)))).toBeNull();
  for (const days of [7, null]) {
    const unused = generateLicenses(database, { count: 1, days, redeemBefore: null })[0];
    expect(() => redeemLicense(database, id, unused.code)).toThrow('当前账号已是无限期，无需续期');
    expect((listLicenses(database, 0, unused.id) as Record<string, unknown>).state).toBe('unused');
  }
});
it('限时账号可升级无限期，不限兑换时间的码长期可用，有限兑换期限仍生效', async () => {
  const { database } = await getAccountAuth();
  const { id } = database.prepare("SELECT id FROM user WHERE username='licensed'").get() as { id: string };
  const now = Date.now();
  database.prepare('INSERT OR REPLACE INTO account_authorization(userId,expiresAt,updatedAt) VALUES(?,?,?)').run(id, now + 86400_000, now);
  const issued = generateLicenses(database, { count: 1, days: null, redeemBefore: null }, now)[0];
  expect(redeemLicense(database, id, issued.code, now + 100 * 365 * 86400_000)).toEqual({ state: 'active', expiresAt: null });
  const expired = generateLicenses(database, { count: 1, days: null, redeemBefore: now + 1000 }, now)[0];
  expect(() => redeemLicense(database, id, expired.code, now + 1000)).toThrow('授权码无效');
  const unused = generateLicenses(database, { count: 1, days: 7, redeemBefore: null }, now)[0];
  revokeLicense(database, unused.id);
  expect((listLicenses(database, 0, unused.id) as Record<string, unknown>).state).toBe('revoked');
  for (const days of [0, -1, 1.5, 3651, undefined]) expect(() => generateLicenses(database, { count: 1, days, redeemBefore: null })).toThrow();
});
