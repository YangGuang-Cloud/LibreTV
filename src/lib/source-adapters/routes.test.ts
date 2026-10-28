import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSourceAdapter } from './index';
import { POST as search } from '@/app/api/search/route';
import { GET as detail } from '@/app/api/detail/route';
import { POST as probe } from '@/app/api/source/test/route';
import { POST as adminEpisodes } from '@/app/api/admin/episodes/route';
import { SESSION_COOKIE, signSession } from '../auth';
import { ADMIN_SESSION_COOKIE, signAdminSession } from '../admin-auth';
import type { SourceConfig } from '../types';

vi.mock('./index', () => ({ getSourceAdapter: vi.fn() }));
const source = { key: 'normalized-route', name: '协议测试', url: 'https://8.8.8.8/adapter' };
const normalized = { sourceKey: source.key, sourceName: source.name, vodId: '1', name: '统一影片' };
const page = vi.fn(async (_source: SourceConfig, _query: string, number: number) => ({ list: [{ ...normalized, vodId: String(number) }], pageCount: 2 }));
const film = vi.fn(async () => ({ episodes: ['https://8.8.8.8/1.m3u8'], episodeTitles: ['开端'], videoInfo: { title: '统一影片', sourceKey: source.key, sourceName: source.name } }));
beforeEach(() => {
  vi.stubEnv('PASSWORD', 'adapter-route-test'); vi.stubEnv('SOURCE_MODE', 'client'); vi.stubEnv('ADMIN_PASSWORD', 'adapter-admin');
  page.mockClear(); film.mockClear();
  vi.mocked(getSourceAdapter).mockReturnValue({ id: 'apple-cms', searchPage: page, detail: film });
});
afterEach(() => vi.unstubAllEnvs());
const request = (path: string, body?: unknown, admin = false) => new Request(`https://local.test${path}`, {
  ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  headers: { 'Content-Type': 'application/json', cookie: admin ? `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}` : `${SESSION_COOKIE}=${signSession().token}` },
});

it('搜索 API 只消费适配器统一分页结果，JSON 与流式协议均不依赖 CMS 字段', async () => {
  const body = { wd: '统一影片', sources: [source], filterAdult: false };
  const response = await search(request('/api/search', body));
  expect(response.status).toBe(200);
  expect((await response.json()).list.map((item: {vodId: string}) => item.vodId)).toEqual(['1', '2']);
  expect(page).toHaveBeenCalledTimes(2);
  const stream = await search(request('/api/search?stream=1', { ...body, wd: '统一影片 流式' }));
  const events = (await stream.text()).trim().split('\n').map((line) => JSON.parse(line));
  expect(events.map((item) => item.type)).toEqual(['source', 'done']);
  expect(events.at(-1).list).toHaveLength(2);
});

it('详情和探活使用同一适配器，保持客户端原有字段', async () => {
  const response = await detail(request(`/api/detail?id=1&source=${encodeURIComponent(JSON.stringify(source))}`));
  expect((await response.json()).videoInfo.title).toBe('统一影片');
  expect(film).toHaveBeenCalledOnce();
  const result = await probe(request('/api/source/test', { url: source.url, adapter: 'apple-cms' }));
  expect(await result.json()).toMatchObject({ ok: true, count: 1 });
  expect(page).toHaveBeenCalledWith(expect.anything(), 'test', 1, expect.objectContaining({ timeoutMs: 6000 }));
});

it('后台分集搜索同样只消费适配器结果', async () => {
  vi.stubEnv('SOURCE_MODE', 'server'); vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '后台源', url: source.url }]));
  vi.stubEnv('SERVER_DATA_DIR', '/private/tmp/luna-adapter-route-no-data');
  const response = await adminEpisodes(request('/api/admin/episodes', { action: 'search', sourceKey: 'env_0', query: '统一影片' }, true));
  expect(response.status).toBe(200);
  expect((await response.json()).list[0]).toMatchObject(normalized);
  expect(page).toHaveBeenCalledOnce();
});
