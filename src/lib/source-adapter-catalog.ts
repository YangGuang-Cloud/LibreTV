/** Client-safe catalog. Implementations and upstream parsing stay on the server. */
export const SOURCE_ADAPTERS = [
  { id: 'apple-cms', name: '苹果 CMS', description: '兼容苹果 CMS 的搜索、详情接口及详情页播放地址提取。' },
] as const;

export type SourceAdapterID = typeof SOURCE_ADAPTERS[number]['id'];
export const DEFAULT_SOURCE_ADAPTER: SourceAdapterID = 'apple-cms';
export function isSourceAdapterID(value: unknown): value is SourceAdapterID {
  return SOURCE_ADAPTERS.some((adapter) => adapter.id === value);
}
