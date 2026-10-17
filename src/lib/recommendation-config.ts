/** 所有来源使用相同的 JSON 接口与字段映射；预置仅用于初始化。 */
export const RECOMMENDATION_PROVIDERS = [
  { id: 'douban', name: '豆瓣热门' }, { id: 'bangumi', name: '新番放送' }, { id: 'hot-list', name: '影视热榜' },
] as const;
export type RecommendationProvider = typeof RECOMMENDATION_PROVIDERS[number]['id'];
export interface RecommendationMapping {
  listPath: string; titlePath: string; coverPath: string; idPath: string; ratingPath: string;
  filterPath?: string; filterValue?: string; httpsCover?: boolean;
}
export interface RecommendationFeed {
  id: string; name: string; group?: string; url?: string; fallbackUrls?: string[]; mapping?: RecommendationMapping;
}
export interface RecommendationSource { id: string; name: string; enabled: boolean; feeds?: RecommendationFeed[] }
export interface RecommendationConfig { sources: RecommendationSource[]; defaultSource: string | null }
export interface RecommendationSnapshot extends RecommendationConfig { revision: string }
export const DEFAULT_MAPPING: RecommendationMapping = { listPath: 'items', titlePath: 'title', coverPath: 'cover', idPath: 'id', ratingPath: 'rating' };
const weekdayNames = ['全部', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export function presetFeeds(id: string, hotBase = 'https://60s.crystelf.top'): RecommendationFeed[] {
  if (id === 'douban') return (['movie', 'tv'] as const).flatMap((type) =>
    (type === 'movie' ? ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'] : ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片']).map((tag, i) => ({
      id: `${type}_${i}`, group: type === 'movie' ? '电影' : '剧集', name: tag,
      url: `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=50&page_start=0`,
      mapping: { ...DEFAULT_MAPPING, listPath: 'subjects', ratingPath: 'rate' },
    })));
  if (id === 'bangumi') return weekdayNames.map((name, day) => ({ id: `day_${day}`, name, url: 'https://api.bgm.tv/calendar',
    mapping: { ...DEFAULT_MAPPING, listPath: '*.items.*', titlePath: 'name_cn|name', coverPath: 'images.large|images.common|images.medium', httpsCover: true, ratingPath: 'rating.score', ...(day ? { filterPath: 'weekday.id', filterValue: String(day) } : {}) },
  }));
  if (id === 'hot-list') return [
    ['movie', '电影周榜'], ['tv_chinese', '国产剧周榜'], ['tv_global', '海外剧周榜'], ['show_chinese', '国内综艺'], ['show_global', '海外综艺'], ['baidu', '百度热播剧'],
  ].map(([key, name]) => {
    const path = key === 'baidu' ? '/v2/baidu/teleplay' : `/v2/douban/weekly/${key}`;
    return { id: key, name, url: hotBase.replace(/\/+$/, '') + path,
      fallbackUrls: hotBase === 'https://60s.viki.moe' ? [] : ['https://60s.viki.moe' + path],
      mapping: { ...DEFAULT_MAPPING, listPath: 'data', coverPath: 'cover|cover_proxy' } };
  });
  return [];
}
export function defaultRecommendationConfig(defaultSource: RecommendationProvider = 'hot-list', hotBase?: string): RecommendationConfig {
  return { sources: RECOMMENDATION_PROVIDERS.map((source) => ({ ...source, enabled: true, feeds: presetFeeds(source.id, hotBase) })), defaultSource };
}
export function validRecommendationID(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id); }
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 50) throw new Error('名称不能为空，最多 50 字');
  return value.trim();
}
function endpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('接口地址无效');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('接口地址须为不含账号密码的 HTTP/HTTPS 地址');
  url.hash = ''; return url.href;
}
function fieldPath(value: unknown, required = false): string {
  if (typeof value !== 'string' || value.length > 200 || (required && !value) || !value.split('|').every((p) => !p || p.split('.').every((part) => /^(?:[a-zA-Z0-9_-]+|\*)$/.test(part) && !['__proto__', 'constructor', 'prototype'].includes(part)))) throw new Error('字段路径无效，请使用点号、* 或 | 分隔');
  return value;
}
export function normalizeRecommendationFeed(value: unknown): RecommendationFeed {
  if (!value || typeof value !== 'object') throw new Error('分类配置无效');
  const feed = value as Record<string, unknown>;
  if (!validRecommendationID(feed.id)) throw new Error('分类编号无效');
  const raw = (feed.mapping ?? DEFAULT_MAPPING) as Record<string, unknown>;
  const mapping: RecommendationMapping = {
    listPath: fieldPath(raw.listPath), titlePath: fieldPath(raw.titlePath, true), coverPath: fieldPath(raw.coverPath, true),
    idPath: fieldPath(raw.idPath ?? ''), ratingPath: fieldPath(raw.ratingPath ?? ''),
  };
  if (raw.httpsCover !== undefined && typeof raw.httpsCover !== 'boolean') throw new Error('海报 HTTPS 开关无效');
  if (raw.httpsCover !== undefined) mapping.httpsCover = raw.httpsCover;
  if (raw.filterPath) {
    mapping.filterPath = fieldPath(raw.filterPath, true);
    if (typeof raw.filterValue !== 'string' || raw.filterValue.length > 100) throw new Error('筛选值无效');
    mapping.filterValue = raw.filterValue;
  }
  if (feed.fallbackUrls !== undefined && (!Array.isArray(feed.fallbackUrls) || feed.fallbackUrls.length > 3)) throw new Error('备用接口最多 3 个');
  return { id: feed.id, name: label(feed.name), ...(feed.group ? { group: label(feed.group) } : {}), url: endpoint(feed.url),
    ...(Array.isArray(feed.fallbackUrls) ? { fallbackUrls: feed.fallbackUrls.map(endpoint) } : {}), mapping };
}
export function normalizeRecommendationConfig(value: unknown, hotBase?: string): RecommendationConfig {
  if (!value || typeof value !== 'object') throw new Error('推荐配置无效');
  const config = value as Record<string, unknown>;
  if (!Array.isArray(config.sources) || config.sources.length > 30) throw new Error('推荐来源最多 30 个');
  const sources = config.sources.map((value): RecommendationSource => {
    if (!value || typeof value !== 'object') throw new Error('推荐来源无效');
    const source = value as Record<string, unknown>;
    if (!validRecommendationID(source.id) || typeof source.enabled !== 'boolean') throw new Error('推荐来源编号或开关无效');
    // 兼容上一版已保存的三个来源，迁移后同样允许编辑全部分类和接口。
    const rawFeeds = source.feeds ?? presetFeeds(source.id, hotBase);
    if (!Array.isArray(rawFeeds) || !rawFeeds.length || rawFeeds.length > 50) throw new Error('每个来源需要 1–50 个分类接口');
    const feeds = rawFeeds.map(normalizeRecommendationFeed);
    if (new Set(feeds.map((feed) => feed.id)).size !== feeds.length) throw new Error('分类编号重复');
    return { id: source.id, name: label(source.name), enabled: source.enabled, feeds };
  });
  if (new Set(sources.map(({ id }) => id)).size !== sources.length) throw new Error('推荐来源重复');
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length ? !enabled.some(({ id }) => id === config.defaultSource) : config.defaultSource !== null) throw new Error('请选择已启用的默认来源；全部关闭时默认来源为空');
  return { sources, defaultSource: config.defaultSource as string | null };
}
/** 观看端只接收显示信息，不接收上游地址、查询令牌或解析规则。 */
export function publicRecommendations(config: RecommendationSnapshot): RecommendationSnapshot {
  return { ...config, sources: config.sources.map(({ id, name, enabled, feeds }) => ({ id, name, enabled, feeds: feeds?.map(({ id, name, group }) => ({ id, name, ...(group ? { group } : {}) })) })) };
}
export function legacyRecommendationDefault(config: RecommendationConfig): RecommendationProvider | null {
  return RECOMMENDATION_PROVIDERS.find(({ id }) => id === config.defaultSource)?.id ?? null;
}
export function effectiveRecommendationSource(config: RecommendationConfig, preferred: string, touched: boolean): string | null {
  const enabled = config.sources.filter((source) => source.enabled);
  if ((touched || preferred !== 'hot-list') && enabled.some(({ id }) => id === preferred)) return preferred;
  return enabled.find(({ id }) => id === config.defaultSource)?.id ?? enabled[0]?.id ?? null;
}
