import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSourceAdapter } from './index';
import { SOURCE_ADAPTERS } from '../source-adapter-catalog';
import { parseSourceConfig, sourceCacheIdentity } from '../source-config';
import { fetchUpstream } from '../fetch-utils';
import { episodeRecordKey } from '../episode-metadata';
import type { SourceConfig } from '../types';

vi.mock('../fetch-utils', () => ({ fetchUpstream: vi.fn() }));
vi.mock('../ssrf', () => ({ checkUpstreamAllowed: vi.fn(async (url: string) => ({ ok: !url.includes('127.0.0.1'), reason: '目标被拒绝' })) }));
const source: SourceConfig = { key: 'adapter-test', name: '测试来源', url: 'https://8.8.8.8/api?token=public-fixture' };
beforeEach(() => vi.mocked(fetchUpstream).mockReset());
afterEach(() => vi.restoreAllMocks());

it('目录中的类型均有实现，旧配置与显式默认类型兼容，未知类型不回退', () => {
  for (const item of SOURCE_ADAPTERS) expect(getSourceAdapter({ adapter: item.id }).id).toBe(item.id);
  expect(getSourceAdapter({})).toBe(getSourceAdapter({ adapter: 'apple-cms' }));
  expect(parseSourceConfig(source)).not.toHaveProperty('adapter');
  expect(parseSourceConfig({ ...source, adapter: 'apple-cms' })).toMatchObject({ adapter: 'apple-cms' });
  for (const adapter of ['unknown', '', null, {}]) {
    expect(parseSourceConfig({ ...source, adapter })).toBeNull();
    expect(() => getSourceAdapter({ adapter } as never)).toThrow('不支持');
  }
  expect(fetchUpstream).not.toHaveBeenCalled();
});

it('默认协议显式化不改变历史身份，不同协议不能共用搜索详情缓存或分集资料', () => {
  const explicit = { ...source, adapter: 'apple-cms' as const };
  const future = { ...source, adapter: 'future-protocol' } as never;
  expect(sourceCacheIdentity(explicit)).toEqual(sourceCacheIdentity(source));
  expect(episodeRecordKey(explicit, '1')).toBe(episodeRecordKey(source, '1'));
  expect(sourceCacheIdentity(future)).not.toEqual(sourceCacheIdentity(source));
  expect(episodeRecordKey(future, '1')).not.toBe(episodeRecordKey(source, '1'));
});

it('搜索在适配器内转换第三方字段、页数与请求参数，保留超时和取消', async () => {
  vi.mocked(fetchUpstream).mockResolvedValue(new Response(JSON.stringify({ pagecount: '3', list: [{ vod_id: 7, vod_name: '测试电影', vod_pic: 'https://8.8.8.8/poster.jpg' }] })));
  const signal = new AbortController().signal;
  const page = await getSourceAdapter(source).searchPage(source, '电影 & 测试', 2, { signal, timeoutMs: 1234 });
  expect(page).toMatchObject({ pageCount: 3, list: [{ vodId: '7', name: '测试电影', sourceKey: source.key, sourceName: source.name }] });
  expect(page.list[0]).not.toHaveProperty('vod_name');
  const [url, options] = vi.mocked(fetchUpstream).mock.calls[0];
  expect(new URL(String(url)).searchParams.get('wd')).toBe('电影 & 测试');
  expect(new URL(String(url)).searchParams.get('pg')).toBe('2');
  expect(new URL(String(url)).searchParams.get('token')).toBe('public-fixture');
  expect(options).toMatchObject({ signal, timeoutMs: 1234 });
});

it.each([null, 'bad', '-5', 'Infinity'])('非法上游页数 %j 限定为一页', async (pagecount) => {
  vi.mocked(fetchUpstream).mockResolvedValue(new Response(JSON.stringify({ pagecount, list: null })));
  expect(await getSourceAdapter(source).searchPage(source, '测试', 1, {})).toEqual({ pageCount: 1, list: [] });
});

it('详情优先标准接口，返回统一分集和影片信息，不携带第三方字段', async () => {
  vi.mocked(fetchUpstream).mockResolvedValue(new Response(JSON.stringify({ list: [{ vod_name: '节目', vod_play_url: '开端$https://8.8.8.8/1.m3u8#重逢$https://8.8.8.8/2.m3u8' }] })));
  const detail = await getSourceAdapter(source).detail({ ...source, detail: 'https://8.8.8.8/site' }, '7', {});
  expect(detail).toMatchObject({ episodes: ['https://8.8.8.8/1.m3u8', 'https://8.8.8.8/2.m3u8'], episodeTitles: ['开端', '重逢'], videoInfo: { title: '节目', sourceKey: source.key } });
  expect(detail).not.toHaveProperty('list');
  expect(fetchUpstream).toHaveBeenCalledTimes(1);
});

it('CMS 详情页回退也受地址校验，不能访问内网，缺资源返回明确错误', async () => {
  vi.mocked(fetchUpstream).mockImplementation(async (url) => String(url).includes('/index.php/') ? new Response('$https://8.8.8.8/fallback.m3u8') : new Response(JSON.stringify({ list: [] })));
  const adapter = getSourceAdapter(source);
  expect((await adapter.detail({ ...source, detail: 'https://8.8.8.8/site' }, '8', {})).episodes).toEqual(['https://8.8.8.8/fallback.m3u8']);
  vi.mocked(fetchUpstream).mockClear();
  await expect(adapter.detail({ ...source, detail: 'http://127.0.0.1' }, '8', {})).rejects.toMatchObject({ status: 400 });
  expect(fetchUpstream).toHaveBeenCalledTimes(1);
  await expect(adapter.detail(source, '8', {})).rejects.toMatchObject({ status: 404 });
});
