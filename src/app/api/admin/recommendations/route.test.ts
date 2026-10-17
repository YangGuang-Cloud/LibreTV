import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { GET, PUT } from './route';
import { GET as status } from '../../status/route';
import { GET as serverConfig } from '../../server/config/route';
import { ADMIN_SESSION_COOKIE, signAdminSession } from '@/lib/admin-auth';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { effectiveRecommendationSource } from '@/lib/recommendation-config';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'libretv-recommendations-'));
  vi.stubEnv('SERVER_DATA_DIR', dir);
  vi.stubEnv('ADMIN_PASSWORD', 'admin'); vi.stubEnv('PASSWORD', 'viewer');
  vi.stubEnv('SOURCE_MODE', 'server'); vi.stubEnv('AUTH_MODE', 'password');
  vi.stubEnv('DEFAULT_RECOMMEND_SOURCE', 'bangumi');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
function request(body?: unknown, role: 'admin' | 'viewer' | 'anonymous' = 'admin') {
  return new Request('https://local.test/api/admin/recommendations', {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: role === 'admin' ? `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}` : role === 'viewer' ? `${SESSION_COOKIE}=${signSession().token}` : '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe('后台推荐配置与动态下发', () => {
  it('仅管理员可读写，观看会话和匿名请求均被拒绝', async () => {
    for (const role of ['viewer', 'anonymous'] as const) {
      expect((await GET(request(undefined, role))).status).toBe(401);
      expect((await PUT(request({ sources: [] }, role))).status).toBe(401);
    }
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect((await GET(request(undefined, 'anonymous'))).status).toBe(503);
  });
  it('首次使用环境默认值，后台保存的名称、顺序、启停和默认值同时下发两端', async () => {
    const initial = await (await GET(request())).json();
    expect(initial.defaultSource).toBe('bangumi');
    const sources = [{ id: 'hot-list', name: '我的榜单', enabled: true }, { id: 'douban', name: '豆瓣', enabled: false }];
    const res = await PUT(request({ revision: initial.revision, sources, defaultSource: 'hot-list' }));
    expect(res.status).toBe(200);
    const saved = await res.json();
    vi.stubEnv('DEFAULT_RECOMMEND_SOURCE', 'douban');
    expect(await (await GET(request())).json()).toEqual(saved);
    const viewer = request(undefined, 'viewer');
    expect((await (await status(viewer)).json()).recommendations).toEqual(saved);
    expect((await (await serverConfig(viewer)).json()).recommendations).toEqual(saved);
    expect((await (await status(request(undefined, 'anonymous'))).json()).recommendations).toBeNull();
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect((await PUT(request({ ...initial, sources: [], defaultSource: null }))).status).toBe(409);
  });
  it('全部移除后保持关闭；个人偏好不影响关闭状态', async () => {
    const initial = await (await GET(request())).json();
    const saved = await (await PUT(request({ revision: initial.revision, sources: [], defaultSource: null }))).json();
    expect((await (await GET(request())).json()).sources).toEqual([]);
    expect(effectiveRecommendationSource(saved, 'douban', true)).toBeNull();
  });
  it('校验非法类型、重复来源、空名称和禁用默认项，不覆盖已保存配置', async () => {
    const initial = await (await GET(request())).json();
    const invalid = [
      { sources: [{ id: 'unknown', name: 'x', enabled: true }], defaultSource: 'unknown' },
      { sources: [initial.sources[0], initial.sources[0]], defaultSource: 'douban' },
      { sources: [{ id: 'douban', name: ' ', enabled: true }], defaultSource: 'douban' },
      { sources: [{ id: 'douban', name: 'x', enabled: false }], defaultSource: 'douban' },
      { sources: initial.sources, defaultSource: null },
    ];
    for (const config of invalid) expect((await PUT(request({ ...config, revision: initial.revision }))).status).toBe(400);
    expect(await (await GET(request())).json()).toEqual(initial);
  });
  it('并发保存不相互覆盖，损坏配置不会悄悄恢复为初始值', async () => {
    const initial = await (await GET(request())).json();
    const responses = await Promise.all([
      PUT(request({ ...initial, defaultSource: 'douban' })), PUT(request({ ...initial, defaultSource: 'hot-list' })),
    ]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    await writeFile(path.join(dir, 'recommendations.json'), '{broken');
    expect((await GET(request())).status).toBe(500);
    expect((await status(request(undefined, 'viewer'))).status).toBe(500);
  });
  it('保留用户选择；停用后回退默认项，重新启用后恢复选择', () => {
    const sources = [{ id: 'douban' as const, name: '豆瓣', enabled: true }, { id: 'bangumi' as const, name: '新番', enabled: true }];
    const config = { sources, defaultSource: 'bangumi' as const };
    expect(effectiveRecommendationSource(config, 'hot-list', false)).toBe('bangumi');
    expect(effectiveRecommendationSource(config, 'douban', true)).toBe('douban');
    expect(effectiveRecommendationSource({ ...config, sources: [{ ...sources[0], enabled: false }, sources[1]] }, 'douban', true)).toBe('bangumi');
    expect(effectiveRecommendationSource(config, 'douban', true)).toBe('douban');
  });
});
