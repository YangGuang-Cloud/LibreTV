import { getCache, setCache } from './fetch-utils';
import { sourceCacheIdentity } from './source-config';
import { getSourceAdapter } from './source-adapters';
import { SourceAdapterError } from './source-adapters/contract';
import type { SourceConfig, VideoDetail } from './types';
export { SourceAdapterError as DetailLoadError } from './source-adapters/contract';

const DETAIL_CACHE_TTL = 60 * 1000;

/** Cache only normalized raw details; apply episode metadata after this layer. */
export async function loadVideoDetail(source: SourceConfig, id: string, signal?: AbortSignal, baseUrl = ''): Promise<VideoDetail> {
  const adapter = getSourceAdapter(source);
  const detailRoot = (source.detail || baseUrl).replace(/\/+$/, '');
  const cacheKey = `detail:${JSON.stringify([sourceCacheIdentity(source), detailRoot, id])}`;
  const cached = getCache<VideoDetail>(cacheKey);
  if (cached) return cached;
  const detail = await adapter.detail(source, id, { signal, baseUrl });
  if (!detail.episodes.length) throw new SourceAdapterError(404, '未找到播放资源');
  setCache(cacheKey, detail, DETAIL_CACHE_TTL);
  return detail;
}
