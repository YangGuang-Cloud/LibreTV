import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeDevices, readDevices, readDeviceHistory } from './account-devices';
import { mediaSessionAllowed } from './account-media-session';
import { getAccountAuth } from './account-auth';
import { generateLicenses, listLicenses } from './account-licenses';
import { POST as register } from '@/app/api/account/register/route';
import { POST as login, DELETE as logout } from '@/app/api/auth/route';
import { POST as redeem } from '@/app/api/account/redeem/route';
import { GET as status } from '@/app/api/status/route';
import { GET as devices, PATCH as manage } from '@/app/api/admin/users/devices/route';
import { ADMIN_SESSION_COOKIE, signAdminSession } from './admin-auth';
const base = 'http://localhost:8080', username = 'DeviceUser1', password = '123456';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let directory: string, cookie = '', userId = '', adminCookie = '';
const req = (url: string, method = 'GET', body?: unknown, cookie?: string, id?: string) => new Request(base + url, { method, headers: { origin: base, 'content-type': 'application/json', 'user-agent': 'TestBrowser/1', ...(cookie ? { cookie } : {}), ...(id ? { 'x-luna-device-id': id } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function issue() { return generateLicenses((await getAccountAuth()).database, { count: 1, days: 30, redeemBefore: Date.now() + 86400_000 })[0]; }
async function signIn(id?: string, existingCookie?: string, name = username) { return login(req('/api/auth', 'POST', { username: name, password }, existingCookie, id)); }
async function verified(existingCookie: string, id?: string) { return (await (await status(req('/api/status', 'GET', undefined, existingCookie, id))).json()).verified; }
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-devices-'));
  vi.stubEnv('AUTH_MODE','account'); vi.stubEnv('BETTER_AUTH_URL',base); vi.stubEnv('BETTER_AUTH_SECRET','device-test-secret-at-least-32-characters'); vi.stubEnv('SERVER_DATA_DIR',directory); vi.stubEnv('ADMIN_PASSWORD','admin-password');
  adminCookie = `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`;
});
afterAll(async () => { (await getAccountAuth()).database.close(); delete (globalThis as typeof globalThis & { lunaAccounts?: unknown }).lunaAccounts; vi.unstubAllEnvs(); await fs.rm(directory,{recursive:true,force:true}); });
it('迁移仅撤销无设备身份的旧会话，保留账号数据，之后初始化不反复清理会话', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('u'); CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT); INSERT INTO session VALUES('old','u'); CREATE TABLE history(value TEXT); INSERT INTO history VALUES('保留历史');");
    initializeDevices(db);
    expect(db.prepare('SELECT * FROM session').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM history').get()).toEqual({ value: '保留历史' });
    db.exec("INSERT INTO session VALUES('new','u')"); initializeDevices(db);
    expect(db.prepare('SELECT id FROM session').get()).toEqual({ id:'new' });
  } finally { db.close(); }
});
it('浏览器获得持久设备 Cookie，重复登录只占一台，退出自动释放名额但保留设备身份', async () => {
  expect((await register(req('/api/account/register','POST',{username,password,code:(await issue()).code}))).status).toBe(200);
  const first = await signIn(); expect(first.status).toBe(200); cookie = cookies(first);
  expect(first.headers.getSetCookie().find(value=>value.startsWith('ltv_device='))).toMatch(/HttpOnly; SameSite=Lax/);
  expect(await verified(cookie)).toBe(true);
  userId = (await(await status(req('/api/status','GET',undefined,cookie))).json()).user.id;
  for(let n=0;n<5;n++) { const response=await signIn(undefined,cookie); expect(response.status).toBe(200); cookie=cookies(response); }
  const {database}=await getAccountAuth(); expect(readDevices(database,userId).total).toBe(1);
  const out=await logout(req('/api/auth','DELETE',undefined,cookie)); expect(out.status).toBe(200); expect(out.headers.get('set-cookie')).not.toContain('ltv_device=');
  expect(readDevices(database,userId).total).toBe(0);
  expect(await verified(cookie)).toBe(false);
  cookie=cookies(await signIn(undefined,cookie)); expect(await verified(cookie)).toBe(true);
});
it('最多三台设备，同一 iOS 标识重登不新增，第四台登录失败且不留下会话', async () => {
  for (const n of [2,3]) expect((await signIn(uuid(n))).status).toBe(200);
  const {database}=await getAccountAuth(); const before=(database.prepare('SELECT COUNT(*) AS n FROM session').get() as {n:number}).n;
  const denied=await signIn(uuid(4)); expect(denied.status).toBe(403); expect((await denied.json()).error).toContain('3 台'); expect(denied.headers.get('set-cookie')).toBeNull();
  expect((database.prepare('SELECT COUNT(*) AS n FROM session').get() as {n:number}).n).toBe(before);
  expect((await signIn(uuid(2))).status).toBe(200); expect(readDevices(database,userId)).toMatchObject({total:3,maximum:3});
});
it('满额后任意一台主动退出可让第四台登录，历史设备不能绕过已满上限', async () => {
  const second=await signIn(uuid(2)); expect(second.status).toBe(200);
  expect((await signIn(uuid(4))).status).toBe(403);
  expect((await logout(req('/api/auth','DELETE',undefined,cookies(second),uuid(2)))).status).toBe(200);
  const {database}=await getAccountAuth();expect(readDevices(database,userId).total).toBe(2);
  const fourth=await signIn(uuid(4));expect(fourth.status).toBe(200);expect(readDevices(database,userId).total).toBe(3);
  expect((await signIn(uuid(2))).status).toBe(403);
  await logout(req('/api/auth','DELETE',undefined,cookies(fourth),uuid(4)));
  expect((await signIn(uuid(2))).status).toBe(200);
});
it('管理接口仅独立管理员可用，不能跨账号退出设备，降低上限前须先释放设备', async () => {
  expect((await devices(req('/api/admin/users/devices?userId='+userId))).status).toBe(401);
  expect((await devices(req('/api/admin/users/devices?userId='+userId,'GET',undefined,cookie))).status).toBe(401);
  expect((await manage(req('/api/admin/users/devices','PATCH',{userId,action:'set-limit',maximum:2},adminCookie))).status).toBe(409);
  for (const n of [0,51,1.5]) expect((await manage(req('/api/admin/users/devices','PATCH',{userId,action:'set-limit',maximum:n},adminCookie))).status).toBe(400);
  expect((await manage(req('/api/admin/users/devices','PATCH',{userId,action:'set-limit',maximum:4},adminCookie))).status).toBe(200);
  expect((await signIn(uuid(4))).status).toBe(200);
  const id=(readDevices((await getAccountAuth()).database,userId).items[0] as {id:string}).id;
  expect((await manage(req('/api/admin/users/devices','PATCH',{userId:'missing',action:'logout-device',deviceId:id},adminCookie))).status).toBe(404);
});
it('拷贝会话但缺少设备身份或换设备标识不能访问，后台退出撤销全部同设备会话并保留账号', async () => {
  const sessionOnly=cookie.split('; ').filter(value=>value.includes('session_token=')).join('; ');
  expect(await verified(sessionOnly)).toBe(false); expect(await verified(cookie,uuid(99))).toBe(false);
  const {database}=await getAccountAuth();
  // The browser has no native header; its database row is found via the linked session, without exposing its fingerprint.
  const browser=(database.prepare('SELECT d.id FROM account_device d JOIN account_device_session ds ON ds.deviceId=d.id JOIN session s ON s.id=ds.sessionId WHERE d.userId=? ORDER BY d.createdAt LIMIT 1').get(userId) as {id:string});
  const sessions=database.prepare('SELECT sessionId FROM account_device_session WHERE deviceId=?').all(browser.id) as {sessionId:string}[];
  expect(await mediaSessionAllowed(sessions[0].sessionId)).toBe(true);
  const result=await manage(req('/api/admin/users/devices','PATCH',{userId,action:'logout-device',deviceId:browser.id},adminCookie));expect(result.status).toBe(200);
  expect(await mediaSessionAllowed(sessions[0].sessionId)).toBe(false);
  expect(await verified(cookie)).toBe(false);expect(readDevices(database,userId).total).toBe(3);
  expect(database.prepare('SELECT id FROM user WHERE id=?').get(userId)).toEqual({id:userId});
  expect(database.prepare('SELECT * FROM account_authorization WHERE userId=?').get(userId)).toBeTruthy();
});
it('满额时凭账号密码续期也不能新增设备，失败不消耗授权码；当前登录设备可续期', async () => {
  expect((await manage(req('/api/admin/users/devices','PATCH',{userId,action:'set-limit',maximum:3},adminCookie))).status).toBe(200);
  const {database}=await getAccountAuth();database.prepare('UPDATE account_authorization SET expiresAt=? WHERE userId=?').run(Date.now()-1,userId);
  const code=await issue();const body={username,password,code:code.code};
  const denied=await redeem(req('/api/account/redeem','POST',body,undefined,uuid(5)));expect(denied.status).toBe(403);
  expect((listLicenses(database,0,code.id) as Record<string,unknown>).state).toBe('unused');
  const success=await redeem(req('/api/account/redeem','POST',body,undefined,uuid(2)));expect(success.status).toBe(200);
  expect(await verified(cookies(success),uuid(2))).toBe(true);expect(readDevices(database,userId).total).toBe(3);
});
it('并发登录争用一个剩余名额时只能绑定一台，其他失败会话清除', async () => {
  const name='LimitDevice2';expect((await register(req('/api/account/register','POST',{username:name,password,code:(await issue()).code}))).status).toBe(200);
  const {database}=await getAccountAuth();const id=(database.prepare('SELECT id FROM user WHERE username=?').get(name) as {id:string}).id;
  expect((await manage(req('/api/admin/users/devices','PATCH',{userId:id,action:'set-limit',maximum:1},adminCookie))).status).toBe(200);
  const results=await Promise.all([10,11,12].map(n=>signIn(uuid(n),undefined,name)));
  expect(results.map(result=>result.status).sort()).toEqual([200,403,403]);expect(readDevices(database,id).total).toBe(1);
  expect(database.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?').get(id)).toEqual({n:1});
});
it('拒绝畸形设备编号并给旧原生客户端升级提示', async () => {
  expect((await signIn('bad-id')).status).toBe(400);
  const old=req('/api/auth','POST',{username,password});old.headers.set('user-agent','Luna12TV/1.0 (iOS 18.0; iPhone17,1)');
  expect((await login(old)).status).toBe(426);
});

it('会话过期自动释放名额，无需管理员操作，历史记录不占名额', async () => {
  const name='ExpiryDevice3';expect((await register(req('/api/account/register','POST',{username:name,password,code:(await issue()).code}))).status).toBe(200);
  const {database}=await getAccountAuth();const id=(database.prepare('SELECT id FROM user WHERE username=?').get(name) as {id:string}).id;
  await manage(req('/api/admin/users/devices','PATCH',{userId:id,action:'set-limit',maximum:1},adminCookie));
  const first=await signIn(uuid(20),undefined,name);expect(first.status).toBe(200);
  database.prepare('UPDATE session SET expiresAt=? WHERE userId=?').run(Date.now()-1,id);
  expect(readDevices(database,id).total).toBe(0);
  expect((await signIn(uuid(21),undefined,name)).status).toBe(200);expect(readDevices(database,id).total).toBe(1);
  expect((await signIn(uuid(20),undefined,name)).status).toBe(403);
});

it('历史列表保留已退出设备、标注当前登录，不返回设备摘要或会话令牌，也不占名额', async () => {
  const { database } = await getAccountAuth();
  const active = readDevices(database, userId);
  const response = await devices(req('/api/admin/users/devices?userId='+userId+'&view=history','GET',undefined,adminCookie));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
  const history = await response.json();
  expect(history.total).toBeGreaterThan(active.total);
  expect(history.items.filter((item: { sessions: number }) => item.sessions > 0)).toHaveLength(active.total);
  expect(history.items.some((item: { sessions: number }) => item.sessions === 0)).toBe(true);
  expect(history.items[0]).toHaveProperty('createdAt'); expect(history.items[0]).toHaveProperty('lastLoginAt');
  expect(JSON.stringify(history)).not.toContain('fingerprint'); expect(JSON.stringify(history)).not.toContain('sessionId');
  expect(readDevices(database,userId).total).toBe(active.total);
  expect((await devices(req('/api/admin/users/devices?userId='+userId+'&view=history'))).status).toBe(401);
  expect((await devices(req('/api/admin/users/devices?userId='+userId+'&view=history','GET',undefined,cookie))).status).toBe(401);
});
it('历史按最近登录倒序分页且账号隔离，非法分类和分页参数被拒绝', async () => {
  const { database } = await getAccountAuth();
  const other = (database.prepare('SELECT id FROM user WHERE username=?').get('ExpiryDevice3') as {id:string}).id;
  const beforeActive = readDevices(database, other).total;
  const add = database.prepare('INSERT INTO account_device VALUES(?,?,?,?,?,?,?,?)');
  const now = Date.now();
  for (let n=0;n<57;n++) add.run(`history-${String(n).padStart(3,'0')}`,other,`history-fingerprint-${n}`,now+n,now+10000+n,now+n,null,null);
  const first=readDeviceHistory(database,other,0),second=readDeviceHistory(database,other,50);
  const firstIds=(first.items as {id:string}[]).map(item=>item.id), secondIds=(second.items as {id:string}[]).map(item=>item.id);
  expect(first.total).toBe(59); expect(firstIds).toHaveLength(50); expect(secondIds).toHaveLength(9);
  expect(firstIds[0]).toBe('history-056'); expect(firstIds[49]).toBe('history-007'); expect(secondIds[0]).toBe('history-006');
  expect(new Set([...firstIds,...secondIds]).size).toBe(59);
  expect(JSON.stringify(readDeviceHistory(database,userId))).not.toContain('history-');
  expect(readDevices(database,other).total).toBe(beforeActive);
  for(const query of ['view=history&offset=-1','view=history&offset=abc','view=unknown']) {
    expect((await devices(req('/api/admin/users/devices?userId='+other+'&'+query,'GET',undefined,adminCookie))).status).toBe(400);
  }
});
