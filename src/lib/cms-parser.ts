import type { SearchResultItem, VideoDetail } from './types';

/**
 * Apple CMS（苹果CMS）资源站响应解析
 * 与旧版 js/api.js 逻辑对齐，迁移为纯函数以便单元测试。
 */

const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;

const UA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

export function cmsRequestHeaders(): Record<string, string> {
  return { ...UA_HEADERS };
}

/** 搜索响应 → 统一结果列表 */
export function parseSearchList(
  data: unknown,
  source: { key: string; name: string; url: string; isAdult?: boolean }
): SearchResultItem[] {
  if (!data || typeof data !== 'object') throw new Error('API返回的数据格式无效');
  const list = (data as { list?: unknown }).list;
  // 部分源站无结果时返回 list: null（而非 []），视为空结果而非格式错误
  if (list !== null && list !== undefined && !Array.isArray(list)) {
    throw new Error('API返回的数据格式无效');
  }
  return (Array.isArray(list) ? list : []).map((item) => {
    const vod = item as Record<string, unknown>;
    return {
      sourceKey: source.key,
      sourceName: source.name,
      vodId: String(vod.vod_id ?? ''),
      name: String(vod.vod_name ?? ''),
      pic: typeof vod.vod_pic === 'string' ? vod.vod_pic : undefined,
      typeName: typeof vod.type_name === 'string' ? vod.type_name : undefined,
      year: typeof vod.vod_year === 'string' ? vod.vod_year : undefined,
      area: typeof vod.vod_area === 'string' ? vod.vod_area : undefined,
      remarks: typeof vod.vod_remarks === 'string' ? vod.vod_remarks : undefined,
      sourceUrl: source.url,
      isAdult: source.isAdult,
    };
  });
}

/**
 * 从 vod_play_url 中提取分集地址：格式 源1$$$源2，集1$URL1#集2$URL2。
 * 部分源（如量子 lziapi、非凡 ffzy）第一条线路是网页中转页（…/share/xxx，不可播），
 * 真实 m3u8 在后面的线路里，因此优先取包含 m3u8 直链的线路；均无 m3u8 时回退第一条。
 */
export function extractEpisodesFromPlayUrl(playUrl: string): string[] {
  return extractEpisodeEntries(playUrl).map((episode) => episode.url);
}

function extractEpisodeEntries(playUrl: string): { title: string; url: string }[] {
  if (!playUrl) return [];
  const groups = playUrl
    .split('$$$')
    .map((group) =>
      group
        .split('#')
        .map((ep) => {
          const separator = ep.indexOf('$');
          return { title: separator >= 0 ? ep.slice(0, separator).trim() : '', url: separator >= 0 ? ep.slice(separator + 1).trim() : '' };
        })
        .filter(({ url }) => url.startsWith('http://') || url.startsWith('https://'))
    )
    .filter((eps) => eps.length > 0);
  if (groups.length === 0) return [];
  return groups.find((eps) => eps.some(({ url }) => url.includes('.m3u8'))) ?? groups[0];
}

/** 从简介文本中兜底提取 m3u8 链接 */
export function extractM3u8FromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(M3U8_PATTERN) || [];
  return matches.map((link) => link.replace(/^\$/, ''));
}

/** 详情 JSON 响应 → 统一详情 */
export function parseDetail(
  data: unknown,
  source: { key: string; name: string; url: string }
): VideoDetail {
  const d = data as { list?: Record<string, unknown>[] };
  if (!d || !Array.isArray(d.list) || d.list.length === 0) {
    throw new Error('获取到的详情内容无效');
  }
  const vod = d.list[0];
  const entries = extractEpisodeEntries(String(vod.vod_play_url ?? ''));
  let episodes = entries.map(({ url }) => url);
  let episodeTitles = entries.map(({ title }) => title);
  if (episodes.length === 0) {
    episodes = extractM3u8FromText(String(vod.vod_content ?? ''));
    episodeTitles = episodes.map(() => '');
  }
  return {
    episodes,
    episodeTitles,
    videoInfo: {
      title: str(vod.vod_name),
      cover: str(vod.vod_pic),
      desc: str(vod.vod_content),
      typeName: str(vod.type_name),
      year: str(vod.vod_year),
      area: str(vod.vod_area),
      director: str(vod.vod_director),
      actor: str(vod.vod_actor),
      remarks: str(vod.vod_remarks),
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
}

/**
 * 部分源的列表接口不返回播放地址，需要爬详情页 HTML 提取 m3u8。
 * 与旧版 handleSpecialSourceDetail 对齐。
 */
export function parseDetailPageHtml(
  html: string,
  source: { key: string; name: string; url: string }
): VideoDetail {
  // 先尝试通用模式，再尝试非凡影视的日期哈希特征路径
  let matches = html.match(/\$(https?:\/\/[^"'\s]+?\.m3u8)/g) || [];
  if (matches.length === 0) {
    matches = html.match(/\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g) || [];
  }
  // 去重并清理尾缀
  const episodes = [...new Set(matches)].map((link) => {
    let u = link.substring(1);
    const parenIndex = u.indexOf('(');
    if (parenIndex > 0) u = u.substring(0, parenIndex);
    return u;
  });

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);

  return {
    episodes,
    episodeTitles: episodes.map(() => ''),
    videoInfo: {
      title: titleMatch ? titleMatch[1].trim() : undefined,
      desc: descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : undefined,
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

export { isAdultContent, filterAdultResults, normalizeTitle, isRelevant, filterRelevantResults } from './search-result-utils';
