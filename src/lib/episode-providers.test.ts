import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { alignEpisodeMetadata, findAutomaticEpisodeMetadata, importEpisodeMetadata, sourceEpisodeOrderIsRegular } from './episode-providers';
import { fetchUpstream } from './fetch-utils';
import type { VideoDetail } from './types';
vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: () => null, setCache: vi.fn() }));
const detail: VideoDetail = { episodes: ['https://cdn/1.m3u8', 'https://cdn/2.m3u8'], episodeTitles: ['第01集', '第02集'], videoInfo: { title: '测试动画', year: '2023', typeName: '日韩动漫', sourceKey: 's', sourceName: 'source' } };
const response = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(() => vi.mocked(fetchUpstream).mockReset());
afterEach(() => vi.restoreAllMocks());
describe('节目资料匹配', () => {
  it('按集序对应，不按 API 返回数组顺序对应', () => {
    expect(alignEpisodeMetadata([{ number: 2, title: '第二话' }, { number: 1, title: '第一话' }], 2)).toEqual(['第一话', '第二话']);
    expect(() => alignEpisodeMetadata([{ number: 1, title: 'A' }, { number: 1, title: 'B' }], 2)).toThrow();
    expect(() => alignEpisodeMetadata([{ number: 1, title: 'A' }, { number: 3, title: 'B' }], 2)).toThrow();
    expect(() => alignEpisodeMetadata([{ number: 1, title: 'A' }], 2)).toThrow();
  });
  it('特别篇、非连续编号及单集影片不自动对应', () => {
    expect(sourceEpisodeOrderIsRegular({ ...detail, episodeTitles: ['第1集', '特别篇'] })).toBe(false);
    expect(sourceEpisodeOrderIsRegular({ ...detail, episodeTitles: ['第2集', '第3集'] })).toBe(false);
    expect(sourceEpisodeOrderIsRegular({ ...detail, episodes: ['https://cdn/1.m3u8'] })).toBe(false);
  });
  it('同名同年且唯一的动画才自动补充，中文章节名称优先', async () => {
    vi.mocked(fetchUpstream).mockImplementation(async (url) => response(url.includes('search') ? { data: [{ id: 1, name: 'Original', name_cn: '测试动画', date: '2023-01-01' }] } : url.includes('/episodes?') ? { total: 2, data: [{ sort: 2, name_cn: '重逢', type: 0 }, { sort: 1, name: 'Beginning', name_cn: '出发', type: 0 }] } : { id: 1, name: 'Original', name_cn: '测试动画', date: '2023-01-01' }));
    expect((await findAutomaticEpisodeMetadata(detail))?.titles).toEqual(['出发', '重逢']);
  });
  it('模糊片名、年份不符、同名歧义都不套用', async () => {
    for (const data of [ [{ id: 1, name_cn: '测试动画续集', date: '2023-01-01' }], [{ id: 1, name_cn: '测试动画', date: '2024-01-01' }], [{ id: 1, name_cn: '测试动画', date: '2023-01-01' }, { id: 2, name_cn: '测试动画', date: '2023-02-01' }] ]) {
      vi.mocked(fetchUpstream).mockResolvedValueOnce(response({ data }));
      expect(await findAutomaticEpisodeMetadata(detail)).toBeNull();
    }
  });
  it('TVmaze 导入指定季，不把其他季或特别篇混进来', async () => {
    vi.mocked(fetchUpstream).mockImplementation(async (url) => response(url.endsWith('/episodes') ? [{ season: 1, number: 1, name: 'Wrong season' }, { season: 2, number: null, name: 'Special' }, { season: 2, number: 2, name: 'B' }, { season: 2, number: 1, name: 'A' }] : { id: 1, name: 'Show', premiered: '2020-01-01' }));
    expect((await importEpisodeMetadata('tvmaze', 1, 2, 2)).titles).toEqual(['A', 'B']);
  });
});
