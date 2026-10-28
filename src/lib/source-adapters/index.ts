import { DEFAULT_SOURCE_ADAPTER } from '../source-adapter-catalog';
import type { SourceConfig } from '../types';
import { appleCMSAdapter } from './apple-cms';
import { SourceAdapterError, type SourceAdapter } from './contract';

const adapters: ReadonlyMap<string, SourceAdapter> = new Map([[appleCMSAdapter.id, appleCMSAdapter]]);
export function getSourceAdapter(source: Pick<SourceConfig, 'adapter'>): SourceAdapter {
  const adapter = adapters.get(source.adapter === undefined ? DEFAULT_SOURCE_ADAPTER : source.adapter);
  if (!adapter) throw new SourceAdapterError(400, '不支持的点播源适配类型，请联系管理员');
  return adapter;
}
