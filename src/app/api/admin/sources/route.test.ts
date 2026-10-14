import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PUT } from './route';
import { GET as config } from '../../server/config/route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { ADMIN_SESSION_COOKIE, signAdminSession } from '@/lib/admin-auth';

vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) } }));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'libretv-admin-'));
  vi.stubEnv('PASSWORD', 'viewer-password');
  vi.stubEnv('ADMIN_PASSWORD', 'admin-password');
  vi.stubEnv('SOURCE_MODE', 'server');
  vi.stubEnv('SERVER_DATA_DIR', dir);
  vi.stubEnv('DEFAULT_SOURCES', '[{"name":"默认源","url":"https://8.8.8.8/api"}]');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

function request(method = 'GET', body?: unknown, admin = 'admin-password', login = true): Request {
  return new Request('https://local.test/api/admin/sources', {
    method, headers: { 'content-type': 'application/json',
      cookie: [login ? `${SESSION_COOKIE}=${signSession().token}` : '',
        admin ? `${ADMIN_SESSION_COOKIE}=${admin === 'admin-password' ? signAdminSession().token : signSession().token}` : '',
      ].filter(Boolean).join('; ') },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
describe('管理员源配置接口', () => {
  it('匿名、观看密码和未配置管理员密码都不能管理', async () => {
    expect((await GET(request('GET', undefined, '', false))).status).toBe(401);
    expect((await GET(request('GET', undefined, 'viewer-password'))).status).toBe(401);
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect((await GET(request())).status).toBe(503);
  });
  it('后台独立登录即可管理，无需观看会话；管理员会话不能用于观看接口', async () => {
    expect((await GET(request('GET', undefined, 'admin-password', false))).status).toBe(200);
    expect((await config(request('GET', undefined, 'admin-password', false))).status).toBe(401);
  });
  it('管理员保存后普通客户端获取最新编号，无须接收接口地址', async () => {
    const initial = await (await GET(request())).json();
    const res = await PUT(request('PUT', { revision: initial.revision, sources: [{ key: 'server_new', name: '新源', url: 'https://1.1.1.1/api?token=private' }] }));
    expect(res.status).toBe(200);
    const clientRes = await config(request('GET', undefined, ''));
    const client = await clientRes.json();
    expect(client.sources).toEqual([{ key: 'server_new', name: '新源', isAdult: false }]);
    expect(JSON.stringify(client)).not.toContain('token=private');
    expect(clientRes.headers.get('cache-control')).toContain('no-store');
    expect((await PUT(request('PUT', { revision: initial.revision, sources: [] }))).status).toBe(409);
  });
  it('拒绝内网源、非法字段和未知配置版本，不覆盖原配置', async () => {
    const initial = await (await GET(request())).json();
    expect((await PUT(request('PUT', { revision: initial.revision, sources: [{ key: 'bad', name: '内网', url: 'http://127.0.0.1/api' }] }))).status).toBe(400);
    expect((await PUT(request('PUT', { revision: initial.revision, sources: [null] }))).status).toBe(400);
    expect((await PUT(request('PUT', { sources: [] }))).status).toBe(400);
    expect((await (await GET(request())).json()).revision).toBe(initial.revision);
  });
});
