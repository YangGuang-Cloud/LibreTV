import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GET, POST } from './route';
import { ADMIN_SESSION_COOKIE, signAdminSession } from '@/lib/admin-auth';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
vi.mock('@/lib/video-detail', () => ({ DetailLoadError: class extends Error {}, loadVideoDetail: vi.fn(async () => ({ episodes: ['https://cdn/1.m3u8', 'https://cdn/2.m3u8'], episodeTitles: ['第1集', '第2集'], videoInfo: { title: '节目', sourceKey: 'env_0', sourceName: '测试源' } })) }));
vi.mock('@/lib/episode-providers', () => ({ findAutomaticEpisodeMetadata: vi.fn(async () => null), searchEpisodeMetadata: vi.fn(async () => []), importEpisodeMetadata: vi.fn(), sourceEpisodeOrderIsRegular: () => true }));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'libretv-admin-episodes-'));
  vi.stubEnv('SERVER_DATA_DIR', dir); vi.stubEnv('PASSWORD', 'viewer'); vi.stubEnv('ADMIN_PASSWORD', 'admin'); vi.stubEnv('SOURCE_MODE', 'server');
  vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '测试源', url: 'https://example.com/api' }]));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
function request(body?: unknown, viewer = false) {
  return new Request('https://local/api/admin/episodes?sourceKey=env_0&id=1', {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { cookie: viewer ? `${SESSION_COOKIE}=${signSession().token}` : `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}` },
  });
}
describe('分集后台权限与保存', () => {
  it('普通观看会话不能读写分集资料', async () => {
    expect((await GET(request(undefined, true))).status).toBe(401);
    expect((await POST(request({ action: 'save' }, true))).status).toBe(401);
  });
  it('管理员修改后立即可读取，重复旧版本返回 409', async () => {
    const initial = await (await GET(request())).json();
    const body = { action: 'save', sourceKey: 'env_0', vodId: '1', manualTitles: ['开端', '重逢'], autoDisabled: true, revision: initial.revision };
    const saved = await POST(request(body));
    expect(saved.status).toBe(200);
    expect((await saved.json()).detail.episodeTitles).toEqual(['开端', '重逢']);
    expect((await POST(request(body))).status).toBe(409);
  });
});
