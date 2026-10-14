import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readEpisodeSnapshot, saveManualEpisodeTitles } from '@/lib/episode-metadata';

vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) } }));
beforeEach(() => vi.stubEnv('PASSWORD', 'test'));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function request(source: unknown, extra?: Record<string, string>): Request {
  const params = new URLSearchParams({ id: '1', source: JSON.stringify(source), ...extra });
  return new Request(`https://local.test/api/detail?${params}`, { headers: { cookie: `${SESSION_COOKIE}=${signSession().token}` } });
}
const source = { key: 'a', name: '源 A', url: 'https://8.8.8.8/api' };
function response() {
  return new Response(JSON.stringify({ list: [{ vod_id: 1, vod_name: '影片', vod_play_url: '第1集$https://8.8.8.8/video.m3u8' }] }));
}
describe('详情接口', () => {
  it('缓存原始详情后，手动标题仍立即更新；资料文件损坏不影响播放', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'libretv-detail-metadata-'));
    try {
      vi.stubEnv('SOURCE_MODE', 'server'); vi.stubEnv('SERVER_DATA_DIR', dir);
      vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '资料更新测试', url: 'https://1.1.1.1/metadata-api' }]));
      vi.stubGlobal('fetch', vi.fn(async () => response()));
      const req = () => request(null, { sourceKey: 'env_0' });
      const raw = await (await GET(req())).json();
      const configured = { key: 'env_0', name: '资料更新测试', url: 'https://1.1.1.1/metadata-api' };
      const snapshot = await readEpisodeSnapshot(configured, '1', raw);
      await saveManualEpisodeTitles(configured, '1', raw, ['标题已修正'], snapshot.revision);
      expect((await (await GET(req())).json()).episodeTitles).toEqual(['标题已修正']);
      await writeFile(path.join(dir, 'episode-metadata.json'), '{bad');
      const fallback = await GET(req());
      expect(fallback.status).toBe(200);
      expect((await fallback.json()).episodes).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('同 URL 不同源身份的详情缓存不混用', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    expect((await (await GET(request(source))).json()).videoInfo.sourceKey).toBe('a');
    const changed = { ...source, key: 'b', name: '源 B' };
    expect((await (await GET(request(changed))).json()).videoInfo).toMatchObject({ sourceKey: 'b', sourceName: '源 B' });
  });
  it('服务器模式按编号解析详情，忽略客户端接口和详情页地址', async () => {
    vi.stubEnv('SOURCE_MODE', 'server');
    vi.stubEnv('SERVER_DATA_DIR', '/private/tmp/libretv-test-no-config-detail');
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '服务端详情', url: 'https://1.1.1.1/api' }]));
    const spy = vi.fn(async (input: RequestInfo | URL) => { void input; return response(); });
    vi.stubGlobal('fetch', spy);
    const res = await GET(request(null, { sourceKey: 'env_0', baseUrl: 'http://127.0.0.1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).videoInfo.sourceName).toBe('服务端详情');
    expect(String(spy.mock.calls[0][0])).toContain('https://1.1.1.1/api');
    expect((await GET(request(source, { sourceKey: 'unknown' }))).status).toBe(400);
  });
  it.each([null, [], { ...source, detail: {} }, { ...source, url: 123 }])('畸形源配置返回 400：%j', async (value) => {
    expect((await GET(request(value))).status).toBe(400);
  });
});
