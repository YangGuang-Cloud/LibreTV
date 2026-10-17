import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_MAPPING, defaultRecommendationConfig, normalizeRecommendationConfig, normalizeRecommendationFeed, publicRecommendations } from './recommendation-config';
import { parseRecommendationFeed, loadRecommendationFeed } from './recommendation-feed';
import { fetchUpstreamWithMeta } from './fetch-utils';
import { validSyncValue } from './sync-model';
vi.mock('./fetch-utils', () => ({ fetchUpstreamWithMeta: vi.fn() }));
const fetcher = vi.mocked(fetchUpstreamWithMeta);
const url = 'https://8.8.8.8/feed.json';
const feed = { id: 'film', name: '片单', url, mapping: DEFAULT_MAPPING };
beforeEach(() => vi.resetAllMocks());
describe('统一 JSON 推荐来源', () => {
  it('三种旧配置都迁移为可编辑的接口与映射，原有分类保留', () => {
    for (const id of ['douban', 'bangumi', 'hot-list']) {
      const config = normalizeRecommendationConfig({ sources: [{ id, name: id, enabled: true }], defaultSource: id });
      expect(config.sources[0].feeds?.length).toBeGreaterThan(1);
      expect(config.sources[0].feeds?.every((feed) => feed.url && feed.mapping)).toBe(true);
    }
  });
  it('自有编号、接口、分组和嵌套字段都可保存，观看端不暴露接口令牌', () => {
    const config = normalizeRecommendationConfig({ sources: [{ id: 'my_list', name: '我的推荐', enabled: true,
      feeds: [{ ...feed, url: url + '?token=secret', group: '电影', mapping: { ...DEFAULT_MAPPING, listPath: 'data.list', titlePath: 'name', coverPath: 'poster.large' } }] }], defaultSource: 'my_list' });
    expect(config.sources[0].feeds?.[0].mapping?.listPath).toBe('data.list');
    const client = publicRecommendations({ ...config, revision: 'revision' });
    expect(client.sources[0].feeds).toEqual([{ id: 'film', name: '片单', group: '电影' }]);
    expect(JSON.stringify(client)).not.toContain('secret');
    expect(validSyncValue('preference', 'recommendSource', 'my_list')).toBe(true);
    expect(validSyncValue('preference', 'recommendSource', 'bad/id')).toBe(false);
  });
  it('通用、苹果 CMS、嵌套和字段备用规则使用同一解析器', () => {
    expect(parseRecommendationFeed({ items: [{ title: '影片', cover: '/a.jpg', rating: 8 }] }, DEFAULT_MAPPING, url)).toEqual([{ id: '影片', title: '影片', cover: 'https://8.8.8.8/a.jpg', rating: '8' }]);
    const mapping = { ...DEFAULT_MAPPING, listPath: 'missing|data.list', titlePath: 'name_cn|name', coverPath: 'images.large' };
    expect(parseRecommendationFeed({ data: { list: [{ id: 1, name_cn: '', name: '标题', images: { large: 'https://example.com/a.jpg' } }] } }, mapping, url)[0].title).toBe('标题');
    expect(parseRecommendationFeed({ list: [{ vod_name: '电影', vod_pic: '/b.jpg' }] }, { ...DEFAULT_MAPPING, listPath: 'list', titlePath: 'vod_name', coverPath: 'vod_pic' }, url)[0].title).toBe('电影');
  });
  it('Bangumi 的全部与星期筛选也使用配置，按编号去重', () => {
    const feeds = defaultRecommendationConfig().sources.find((s) => s.id === 'bangumi')!.feeds!;
    const raw = [{ weekday: { id: 2 }, items: [{ id: 1, name: '动画', images: { large: 'http://lain.bgm.tv/a.jpg' } }] }, { weekday: { id: 1 }, items: [{ id: 2, name: '周一', images: { large: '/b.jpg' } }] }];
    expect(parseRecommendationFeed(raw, feeds[0].mapping!, url).map((i) => i.title)).toEqual(['动画', '周一']);
    expect(parseRecommendationFeed(raw, feeds[0].mapping!, url)[0].cover).toBe('https://lain.bgm.tv/a.jpg');
    expect(parseRecommendationFeed(raw, feeds[1].mapping!, url).map((i) => i.title)).toEqual(['周一']);
    expect(parseRecommendationFeed(raw, feeds[7].mapping!, url)).toEqual([]);
  });
  it('空列表有效；错误路径、空片名/海报和危险字段给出明确结果', () => {
    expect(parseRecommendationFeed({ items: [] }, DEFAULT_MAPPING, url)).toEqual([]);
    expect(() => parseRecommendationFeed({ wrong: [] }, DEFAULT_MAPPING, url)).toThrow('列表');
    expect(() => parseRecommendationFeed({ items: [{ title: 'x', cover: 'javascript:alert(1)' }] }, DEFAULT_MAPPING, url)).toThrow('海报');
    expect(() => normalizeRecommendationFeed({ ...feed, mapping: { ...DEFAULT_MAPPING, titlePath: '__proto__.name' } })).toThrow('路径');
    expect(() => normalizeRecommendationFeed({ ...feed, url: 'file:///tmp/private' })).toThrow();
    expect(() => normalizeRecommendationFeed({ ...feed, url: 'https://user:pass@example.com/' })).toThrow();
  });
  it('按配置请求上游并使用最终地址解析相对海报，备用接口也遵循相同请求路径', async () => {
    fetcher.mockRejectedValueOnce(new Error('network token=secret'));
    fetcher.mockResolvedValueOnce({ res: Response.json({ items: [{ title: '标题', cover: 'cover.jpg' }] }), finalUrl: 'https://example.com/data/feed' });
    expect((await loadRecommendationFeed({ ...feed, fallbackUrls: ['https://1.1.1.1/api'] }))[0].cover).toBe('https://example.com/data/cover.jpg');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([url, 'https://1.1.1.1/api']);
  });
  it('拒绝过大响应和非 JSON，网络异常不泄露接口令牌', async () => {
    fetcher.mockResolvedValueOnce({ res: new Response('x', { headers: { 'Content-Length': '3000000' } }), finalUrl: url });
    await expect(loadRecommendationFeed(feed)).rejects.toThrow('2 MB');
    fetcher.mockResolvedValueOnce({ res: new Response('<html>'), finalUrl: url });
    await expect(loadRecommendationFeed(feed)).rejects.toThrow('JSON');
    fetcher.mockRejectedValueOnce(new Error('token=secret'));
    await expect(loadRecommendationFeed(feed)).rejects.toThrow('无法获取');
  });
});
