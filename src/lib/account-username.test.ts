import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getAccountAuth } from './account-auth';
import { validUsername } from './account-users';
import { generateLicenses, listLicenses } from './account-licenses';
import { POST as register } from '@/app/api/account/register/route';
import { POST as login } from '@/app/api/auth/route';
import { POST as redeem } from '@/app/api/account/redeem/route';
const base = 'http://localhost:8080';
let directory: string;
let sequence = 0;
const request = (route: string, body: unknown, cookie?: string) => new Request(base + route, {
  method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-luna-device-id': '11111111-1111-4111-8111-111111111111', 'x-forwarded-for': `192.0.2.${++sequence}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function issue() { return generateLicenses((await getAccountAuth()).database, { count: 1, days: 30, redeemBefore: null })[0]; }
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-username-'));
  vi.stubEnv('AUTH_MODE', 'account'); vi.stubEnv('BETTER_AUTH_URL', base);
  vi.stubEnv('BETTER_AUTH_SECRET', 'username-test-secret-at-least-32-characters'); vi.stubEnv('SERVER_DATA_DIR', directory);
});
afterAll(async () => {
  (await getAccountAuth()).database.close();
  delete (globalThis as typeof globalThis & { lunaAccounts?: unknown }).lunaAccounts;
  vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true });
});
it('新账号只接受 6–20 位字母或数字并保留大小写', () => {
  for (const name of ['Abc123', '123456', 'ABCdef', 'A'.repeat(20)]) expect(validUsername(name)).toBe(name);
  for (const name of ['Ab123', 'A'.repeat(21), 'Name_123', '名字123456', 'Name-123', 'Name 123']) expect(() => validUsername(name)).toThrow('6–20');
});
it('大小写不同可分别注册，登录和续期精确匹配账号，重复注册不消耗码', async () => {
  for (const [username, password] of [['CaseUser1', 'Secret111'], ['caseuser1', 'Secret222']]) {
    expect((await register(request('/api/account/register', { username, password, code: (await issue()).code }))).status).toBe(200);
    expect((await login(request('/api/auth', { username, password }))).status).toBe(200);
    expect((await redeem(request('/api/account/redeem', { username, password, code: (await issue()).code }))).status).toBe(200);
  }
  expect((await login(request('/api/auth', { username: 'caseuser1', password: 'Secret111' }))).ok).toBe(false);
  expect((await login(request('/api/auth', { username: 'CASEUSER1', password: 'Secret111' }))).ok).toBe(false);
  const unused = await issue();
  expect((await register(request('/api/account/register', { username: 'CaseUser1', password: 'Secret111', code: unused.code }))).status).toBe(409);
  const signedIn = await login(request('/api/auth', { username: 'CaseUser1', password: 'Secret111' }));
  expect((await redeem(request('/api/account/redeem', { username: 'caseuser1', code: unused.code }, cookies(signedIn)))).status).toBe(400);
  expect((listLicenses((await getAccountAuth()).database, 0, unused.id) as Record<string, unknown>).state).toBe('unused');
});
it('历史短账号与下划线账号不迁移，仍可激活和登录；新注册拒绝旧格式', async () => {
  const { auth, database } = await getAccountAuth();
  for (const username of ['old', 'old_name']) {
    await auth.api.createUser({ body: { email: `${username}@accounts.invalid`, password: 'Secret333', name: username, data: { username, displayUsername: username } } });
    expect((await redeem(request('/api/account/redeem', { username, password: 'Secret333', code: (await issue()).code }))).status).toBe(200);
    expect((await login(request('/api/auth', { username, password: 'Secret333' }))).status).toBe(200);
    expect(database.prepare('SELECT username FROM user WHERE username=?').get(username)).toEqual({ username });
  }
  for (const username of ['short', 'new_name', 'A'.repeat(21)]) {
    const unused = await issue();
    expect((await register(request('/api/account/register', { username, password: 'Secret333', code: unused.code }))).status).toBe(400);
    expect((listLicenses(database, 0, unused.id) as Record<string, unknown>).state).toBe('unused');
  }
});
it('成功登录不累积失败额度，连续失败限流带等待时间，激活也保留 429 状态', async () => {
  const username = 'LimitUser1', password = 'Secret444';
  expect((await register(request('/api/account/register', { username, password, code: (await issue()).code }))).status).toBe(200);
  const attempt = (pass: string) => {
    const input = request('/api/auth', { username, password: pass });
    input.headers.set('x-forwarded-for', '192.0.2.240');
    return login(input);
  };
  for (let i = 0; i < 12; i++) expect((await attempt(password)).status).toBe(200);
  for (let i = 0; i < 10; i++) expect((await attempt('incorrect')).status).toBe(401);
  const blocked = await attempt(password);
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  expect((await blocked.json()).error).toContain('分钟后重试');
  const input = request('/api/account/redeem', { username, password, code: (await issue()).code });
  input.headers.set('x-forwarded-for', '192.0.2.240');
  expect((await redeem(input)).status).toBe(429);
});
