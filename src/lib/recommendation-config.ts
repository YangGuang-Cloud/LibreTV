/** 共享给服务器、后台和观看网页的推荐来源配置。数组顺序就是显示顺序。 */
export const RECOMMENDATION_PROVIDERS = [
  { id: 'douban', name: '豆瓣热门' },
  { id: 'bangumi', name: '新番放送' },
  { id: 'hot-list', name: '影视热榜' },
] as const;
export type RecommendationProvider = typeof RECOMMENDATION_PROVIDERS[number]['id'];
export interface RecommendationSource {
  id: RecommendationProvider;
  name: string;
  enabled: boolean;
}
export interface RecommendationConfig {
  sources: RecommendationSource[];
  defaultSource: RecommendationProvider | null;
}
export interface RecommendationSnapshot extends RecommendationConfig { revision: string }
export function defaultRecommendationConfig(defaultSource: RecommendationProvider = 'hot-list'): RecommendationConfig {
  return { sources: RECOMMENDATION_PROVIDERS.map((source) => ({ ...source, enabled: true })), defaultSource };
}
export function normalizeRecommendationConfig(value: unknown): RecommendationConfig {
  if (!value || typeof value !== 'object') throw new Error('推荐配置无效');
  const config = value as Record<string, unknown>;
  if (!Array.isArray(config.sources) || config.sources.length > RECOMMENDATION_PROVIDERS.length) throw new Error('推荐来源列表无效');
  const sources = config.sources.map((value): RecommendationSource => {
    if (!value || typeof value !== 'object') throw new Error('推荐来源无效');
    const source = value as Record<string, unknown>;
    if (!RECOMMENDATION_PROVIDERS.some(({ id }) => id === source.id) || typeof source.name !== 'string' ||
        !source.name.trim() || source.name.trim().length > 50 || typeof source.enabled !== 'boolean') throw new Error('推荐来源类型、名称或开关无效');
    return { id: source.id as RecommendationProvider, name: source.name.trim(), enabled: source.enabled };
  });
  if (new Set(sources.map(({ id }) => id)).size !== sources.length) throw new Error('推荐来源重复');
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length ? !enabled.some(({ id }) => id === config.defaultSource) : config.defaultSource !== null) {
    throw new Error(enabled.length ? '请选择一个已启用的默认推荐来源' : '全部关闭时默认推荐来源必须为空');
  }
  return { sources, defaultSource: config.defaultSource as RecommendationProvider | null };
}
/** 只计算显示项，不改写个人偏好；来源恢复启用后可继续使用原来的选择。 */
export function effectiveRecommendationSource(config: RecommendationConfig, preferred: RecommendationProvider, touched: boolean): RecommendationProvider | null {
  const enabled = config.sources.filter((source) => source.enabled);
  // 老版本没有 touched 标记时，非出厂默认值也视为已有偏好。
  if ((touched || preferred !== 'hot-list') && enabled.some(({ id }) => id === preferred)) return preferred;
  return enabled.find(({ id }) => id === config.defaultSource)?.id ?? enabled[0]?.id ?? null;
}
