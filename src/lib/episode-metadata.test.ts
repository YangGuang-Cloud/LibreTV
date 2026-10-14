import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readEpisodeSnapshot, saveManualEpisodeTitles, saveImportedEpisodeTitles, clearImportedEpisodeTitles, mergeEpisodeTitles, enrichEpisodeTitles } from './episode-metadata';
import { findAutomaticEpisodeMetadata } from './episode-providers';
import type { VideoDetail } from './types';

vi.mock('./episode-providers', () => ({ findAutomaticEpisodeMetadata: vi.fn(async () => null) }));
const source = { key: 'test', name: '测试源', url: 'https://cdn.example/api' };
const detail: VideoDetail = { episodes: ['https://cdn.example/1.m3u8', 'https://cdn.example/2.m3u8'], episodeTitles: ['第1集', '源有标题'], videoInfo: { title: '测试节目', year: '2023', sourceKey: 'test', sourceName: '测试源' } };
const imported = { candidate: { provider: 'tvmaze' as const, id: 1, title: 'Example', originalTitle: 'Example', year: '2023', url: 'https://www.tvmaze.com/shows/1' }, season: 1, titles: ['资料标题1', '资料标题2'] };
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'libretv-episode-'));
  vi.stubEnv('SERVER_DATA_DIR', dir); vi.mocked(findAutomaticEpisodeMetadata).mockResolvedValue(null);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe('分集资料持久化与优先级', () => {
  it('手动 > 源真实名称 > 补充资料，清空手动后恢复后两者', async () => {
    await saveImportedEpisodeTitles(source, '1', detail, imported);
    let snapshot = await readEpisodeSnapshot(source, '1', detail);
    expect(mergeEpisodeTitles(detail, snapshot).episodeTitles).toEqual(['资料标题1', '源有标题']);
    await saveManualEpisodeTitles(source, '1', detail, ['修正名称', ''], snapshot.revision);
    snapshot = await readEpisodeSnapshot(source, '1', detail);
    expect(mergeEpisodeTitles(detail, snapshot).episodeTitles).toEqual(['修正名称', '源有标题']);
    expect(mergeEpisodeTitles(detail, snapshot).episodeTitleOrigins).toEqual(['manual', 'source']);
    await saveManualEpisodeTitles(source, '1', detail, ['', ''], snapshot.revision);
    expect(mergeEpisodeTitles(detail, await readEpisodeSnapshot(source, '1', detail)).episodeAttributions?.[0].name).toContain('TVmaze');
  });
  it('源 URL 或播放列表顺序改变时不套用旧资料，签名 query 变化不影响绑定', async () => {
    await saveImportedEpisodeTitles(source, '2', detail, imported);
    expect((await readEpisodeSnapshot({ ...source, url: 'https://other.example/api' }, '2', detail)).record).toBeNull();
    const changed = { ...detail, episodes: [...detail.episodes].reverse() };
    const snapshot = await readEpisodeSnapshot(source, '2', changed);
    expect(snapshot.stale).toBe(true);
    expect(mergeEpisodeTitles(changed, snapshot).episodeTitles?.[0]).toBe('第1集');
    expect((await readEpisodeSnapshot(source, '2', { ...detail, episodes: detail.episodes.map((url) => `${url}?signed=token`) })).stale).toBe(false);
    expect((await readEpisodeSnapshot(source, '2', { ...detail, episodes: detail.episodes.map((url) => `${url}?episode=other`) })).stale).toBe(true);
  });
  it('同一旧版本的并发手动提交只有一份成功', async () => {
    const { revision } = await readEpisodeSnapshot(source, '3', detail);
    const results = await Promise.allSettled([saveManualEpisodeTitles(source, '3', detail, ['A', ''], revision), saveManualEpisodeTitles(source, '3', detail, ['B', ''], revision)]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  });
  it('停用资料保留手动修正，不立刻自动重新导入', async () => {
    await saveImportedEpisodeTitles(source, '4', detail, imported);
    let snapshot = await readEpisodeSnapshot(source, '4', detail);
    await saveManualEpisodeTitles(source, '4', detail, ['手动', ''], snapshot.revision);
    snapshot = await readEpisodeSnapshot(source, '4', detail);
    await clearImportedEpisodeTitles(source, '4', detail, snapshot.revision);
    snapshot = await readEpisodeSnapshot(source, '4', detail);
    expect(snapshot.record?.imported).toBeUndefined();
    expect(snapshot.record?.manualTitles[0]).toBe('手动');
    expect(snapshot.record?.autoDisabled).toBe(true);
  });
  it('外部查询失败仍返回可播放详情', async () => {
    vi.mocked(findAutomaticEpisodeMetadata).mockRejectedValueOnce(new Error('timeout'));
    expect((await enrichEpisodeTitles(source, '5', detail)).episodes).toEqual(detail.episodes);
  });
  it('坏文件不覆盖，错误数量和过长标题拒绝保存', async () => {
    const { revision } = await readEpisodeSnapshot(source, '6', detail);
    expect(() => saveManualEpisodeTitles(source, '6', detail, ['缺一集'], revision)).toThrow();
    expect(() => saveManualEpisodeTitles(source, '6', detail, ['a'.repeat(301), ''], revision)).toThrow();
    await writeFile(path.join(dir, 'episode-metadata.json'), '{bad');
    await expect(readEpisodeSnapshot(source, '6', detail)).rejects.toThrow();
  });
});
