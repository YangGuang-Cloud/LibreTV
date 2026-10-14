import { cmsRequestHeaders, parseDetail, parseDetailPageHtml } from './cms-parser';
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { checkUpstreamAllowed } from './ssrf';
import { sourceCacheIdentity } from './source-config';
import type { SourceConfig, VideoDetail } from './types';

const DETAIL_CACHE_TTL = 60 * 1000;
export class DetailLoadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 缓存源的原始详情；分集补充在返回给客户端前合并，管理员编辑立即生效。 */
export async function loadVideoDetail(source: SourceConfig, id: string, signal?: AbortSignal, baseUrl = ''): Promise<VideoDetail> {
    // 命中 60s 缓存直接返回（仅缓存成功拿到剧集的结果）
    const detailRootForCache = (source.detail || baseUrl || '').replace(/\/+$/, '');
    const cacheKey = `detail:${JSON.stringify([sourceCacheIdentity(source), detailRootForCache, id])}`;
    const cached = getCache<VideoDetail>(cacheKey);
    if (cached) {
      return cached;
    }

    // 用户可控地址发起服务端请求，先过 SSRF 校验（协议白名单 + 内网/保留地址）
    const listVerdict = await checkUpstreamAllowed(source.url);
    if (!listVerdict.ok) {
      throw new DetailLoadError(400, listVerdict.reason || '源地址不可用');
    }

    let resolved: VideoDetail | null = null;

    // 1) 标准列表接口
    const api = new URL(source.url);
    api.searchParams.set('ac', 'videolist');
    api.searchParams.set('ids', id);
    const res = await fetchUpstream(api.href, { timeoutMs: 10000, headers: cmsRequestHeaders(), signal: signal });
    if (res.ok) {
      const data = await res.json();
      try {
        const detail = parseDetail(data, source);
        if (detail.episodes.length > 0) {
          resolved = detail;
        }
        // 有详情但无播放地址 → 继续尝试详情页
      } catch {
        // 列表接口无内容 → 继续尝试详情页
      }
    }

    // 2) 详情页 HTML 提取（detail 地址优先，否则用 API 地址推导）
    const detailRoot = (source.detail || baseUrl || '').replace(/\/+$/, '');
    if (!resolved && detailRoot && /^https?:\/\//.test(detailRoot)) {
      const detailVerdict = await checkUpstreamAllowed(detailRoot);
      if (!detailVerdict.ok) {
        throw new DetailLoadError(400, detailVerdict.reason || '详情页地址不可用');
      }
      const detailUrl = `${detailRoot}/index.php/vod/detail/id/${id}.html`;
      const detailRes = await fetchUpstream(detailUrl, {
        signal: signal,
        timeoutMs: 10000,
        headers: { 'User-Agent': cmsRequestHeaders()['User-Agent'] },
      });
      if (detailRes.ok) {
        const html = await detailRes.text();
        resolved = parseDetailPageHtml(html, source);
      }
    }

    if (!resolved || resolved.episodes.length === 0) {
      throw new DetailLoadError(404, '未找到播放资源');
    }
    setCache(cacheKey, resolved, DETAIL_CACHE_TTL);
    return resolved;
}
