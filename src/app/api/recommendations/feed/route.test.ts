import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { GET } from './route';
import { GET as adminGet, PUT } from '../../admin/recommendations/route';
import { POST as preview } from '../../admin/recommendations/preview/route';
import { GET as config } from '../../server/config/route';
import { readRecommendations, saveRecommendations } from '@/lib/server-recommendations';
import { fetchUpstreamWithMeta } from '@/lib/fetch-utils';
import { DEFAULT_MAPPING } from '@/lib/recommendation-config';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { ADMIN_SESSION_COOKIE, signAdminSession } from '@/lib/admin-auth';
vi.mock('@/lib/fetch-utils', () => ({ fetchUpstreamWithMeta: vi.fn() }));
vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) } }));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'recommend-feed-route-'));
  vi.stubEnv('SERVER_DATA_DIR', dir); vi.stubEnv('PASSWORD', 'viewer'); vi.stubEnv('ADMIN_PASSWORD', 'admin'); vi.stubEnv('AUTH_MODE', 'password'); vi.stubEnv('SOURCE_MODE', 'server');
  vi.mocked(fetchUpstreamWithMeta).mockReset();
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
function request(path = '/api/recommendations/feed?source=mine&feed=films', role = 'viewer', body?: unknown, method = 'POST') {
  return new Request('https://local.test' + path, { method: body ? method : 'GET', headers: {
    'Content-Type': 'application/json', cookie: role === 'admin' ? `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}` : role === 'viewer' ? `${SESSION_COOKIE}=${signSession().token}` : '',
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const feed = { id: 'films', name: '电影', url: 'https://8.8.8.8/list?token=private', mapping: DEFAULT_MAPPING };
it('观看端只提交编号，修改任意来源接口后不复用旧缓存；停用后不可请求', async () => {
  const initial = await readRecommendations();
  let saved = await saveRecommendations({ sources: [{ id: 'mine', name: '我的片单', enabled: true, feeds: [feed] }], defaultSource: 'mine' }, initial.revision);
  vi.mocked(fetchUpstreamWithMeta).mockImplementation(async (url) => ({ res: Response.json({ items: [{ title: String(url).includes('new') ? '新片' : '旧片', cover: '/cover.jpg' }] }), finalUrl: String(url) }));
  expect((await GET(request(undefined, 'anonymous'))).status).toBe(401);
  expect((await (await GET(request())).json()).items[0].title).toBe('旧片');
  await GET(request('/api/recommendations/feed?source=mine&feed=films&url=http://127.0.0.1/'));
  expect(fetchUpstreamWithMeta).toHaveBeenCalledTimes(1);
  const info = await (await config(request())).json();
  expect(JSON.stringify(info.recommendations)).not.toContain('private');
  saved = await saveRecommendations({ ...saved, sources: [{ ...saved.sources[0], feeds: [{ ...feed, url: 'https://8.8.8.8/new' }] }] }, saved.revision);
  expect((await (await GET(request())).json()).items[0].title).toBe('新片');
  await saveRecommendations({ ...saved, defaultSource: null, sources: [{ ...saved.sources[0], enabled: false }] }, saved.revision);
  expect((await GET(request())).status).toBe(404);
});
it('管理员预览使用草稿而不保存，普通用户无预览权限，私网保存被拒绝', async () => {
  const initial = await readRecommendations();
  vi.mocked(fetchUpstreamWithMeta).mockResolvedValue({ res: Response.json({ items: [{ title: '预览电影', cover: '/a.jpg' }] }), finalUrl: feed.url });
  expect((await preview(request('/api/admin/recommendations/preview', 'viewer', { feed }))).status).toBe(401);
  const result = await preview(request('/api/admin/recommendations/preview', 'admin', { feed }));
  expect((await result.json()).items[0].title).toBe('预览电影');
  expect((await readRecommendations()).revision).toBe(initial.revision);
  const bad = { sources: [{ id: 'mine', name: '私网', enabled: true, feeds: [{ ...feed, url: 'http://127.0.0.1/' }] }], defaultSource: 'mine', revision: initial.revision };
  expect((await PUT(request('/api/admin/recommendations', 'admin', bad, 'PUT'))).status).toBe(400);
  expect((await (await adminGet(request('/api/admin/recommendations', 'admin'))).json()).revision).toBe(initial.revision);
});
