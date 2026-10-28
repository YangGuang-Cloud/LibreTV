import type { SourceConfig } from './types';
import { DEFAULT_SOURCE_ADAPTER, isSourceAdapterID } from './source-adapter-catalog';

/** 请求体是外部输入；TypeScript 类型断言不能替代运行时校验。 */
export function parseSourceConfig(value: unknown): SourceConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.key !== 'string' || !/^[\w-]{1,80}$/.test(obj.key)) return null;
  if (typeof obj.name !== 'string' || !obj.name.trim() || obj.name.length > 100) return null;
  if (typeof obj.url !== 'string' || obj.url.length > 2048) return null;
  try {
    const url = new URL(obj.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (obj.detail !== undefined && obj.detail !== '') {
      if (typeof obj.detail !== 'string' || obj.detail.length > 2048) return null;
      const detail = new URL(obj.detail);
      if (!['http:', 'https:'].includes(detail.protocol) || detail.username || detail.password) return null;
    }
  } catch { return null; }
  if (obj.isAdult !== undefined && typeof obj.isAdult !== 'boolean') return null;
  if (obj.adapter !== undefined && !isSourceAdapterID(obj.adapter)) return null;
  return {
    key: obj.key, name: obj.name.trim(), url: obj.url.trim().replace(/\/+$/, ''),
    detail: typeof obj.detail === 'string' && obj.detail.trim() ? obj.detail.trim().replace(/\/+$/, '') : undefined,
    isAdult: obj.isAdult === true,
    ...(obj.adapter !== undefined ? { adapter: obj.adapter } : {}),
  };
}

export function sourceCacheIdentity(source: SourceConfig): unknown[] {
  return [source.key, source.name, source.url, source.detail ?? '', source.isAdult === true, source.adapter ?? DEFAULT_SOURCE_ADAPTER];
}

/** Preserve existing source/history identifiers for the default protocol. */
export function sourceProtocolIdentity(source: SourceConfig): string[] {
  const adapter = source.adapter ?? DEFAULT_SOURCE_ADAPTER;
  return adapter === DEFAULT_SOURCE_ADAPTER ? [] : [adapter];
}
