import { isObject, SYNC_PREFERENCE_KEYS, syncId, validSyncValue, type SyncCollection } from './sync-model';

/** 只选个人数据，测速缓存、下载文件和服务器公共配置不进入账号。 */
export function settingsMap(state: unknown): Map<string, { collection: SyncCollection; key: string; value: unknown }> {
  const entries = new Map<string, { collection: SyncCollection; key: string; value: unknown }>();
  if (!isObject(state)) return entries;
  const add = (collection: SyncCollection, key: string, value: unknown) => { if (key && key.length <= 4096 && validSyncValue(collection, key, value) && JSON.stringify(value).length <= 256_000) entries.set(syncId(collection, key), { collection, key, value }); };
  for (const key of SYNC_PREFERENCE_KEYS) if (key in state) add('preference', key, state[key]);
  if (Array.isArray(state.liveFavorites)) for (const url of state.liveFavorites) if (typeof url === 'string') add('favorite', url, true);
  if (Array.isArray(state.liveRecent)) for (const row of state.liveRecent) if (isObject(row) && typeof row.url === 'string') add('recent', row.url, row);
  return entries;
}
