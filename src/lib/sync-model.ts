import { validRecommendationID } from './recommendation-config';
/** Web 与原生客户端共用的账号数据协议；版本由服务器分配，不信任设备时钟。 */
export const SYNC_PROTOCOL = 1;
export const SYNC_BATCH_SIZE = 100;
export const SYNC_PAGE_SIZE = 500;
export const SYNC_COLLECTIONS = ['history', 'progress', 'search', 'preference', 'favorite', 'recent'] as const;
export type SyncCollection = typeof SYNC_COLLECTIONS[number];
export const SYNC_PREFERENCE_KEYS = [
  'customAPIs', 'selectedKeys', 'envKeysSeen', 'subscriptions', 'liveEnvKeysSeen',
  'liveSubscriptions', 'liveSelectedUrls', 'envSubsSeen', 'yellowFilter', 'adFilter',
  'doubanEnabled', 'recommendSource', 'recommendSourceTouched', 'autoplayNext',
  'imageProxyMode', 'imageProxyModeTouched', 'customImageProxy',
] as const;
export type PreferenceKey = typeof SYNC_PREFERENCE_KEYS[number];
export interface SyncMutation {
  id: string;
  collection: SyncCollection;
  key: string;
  baseVersion: number;
  value: unknown;
}
export interface SyncRecord {
  collection: SyncCollection;
  key: string;
  value: unknown;
  version: number;
  updatedAt: number;
}
export interface SyncRequest { protocol: number; accountId: string; cursor: number; mutations: SyncMutation[]; }
export interface SyncResponse {
  protocol: number;
  accountId: string;
  cursor: number;
  more: boolean;
  records: SyncRecord[];
  results: { id: string; accepted: boolean; record: SyncRecord }[];
}
export const syncId = (collection: SyncCollection, key: string) => JSON.stringify([collection, key]);
export const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 4096) => typeof value === 'string' && value.length <= max;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e15;
const strings = (value: unknown) => Array.isArray(value) && value.length <= 2000 && value.every((item) => text(item));
function preference(key: string, value: unknown): boolean {
  if (!(SYNC_PREFERENCE_KEYS as readonly string[]).includes(key)) return false;
  if (['yellowFilter', 'adFilter', 'doubanEnabled', 'recommendSourceTouched', 'autoplayNext', 'imageProxyModeTouched'].includes(key)) return typeof value === 'boolean';
  if (key === 'recommendSource') return validRecommendationID(value);
  if (key === 'imageProxyMode') return ['direct', 'proxy', 'custom'].includes(String(value));
  if (key === 'customImageProxy') return text(value);
  if (['customAPIs', 'subscriptions', 'liveSubscriptions'].includes(key)) return Array.isArray(value) && value.length <= 2000 && value.every((item) => isObject(item) && text(item.url) && !!item.url && (key !== 'customAPIs' || (text(item.key, 200) && text(item.name, 300))) && (item.name === undefined || text(item.name, 300)) && (item.enabled === undefined || typeof item.enabled === 'boolean') && (item.fromSubscriptions === undefined || strings(item.fromSubscriptions)));
  return strings(value);
}
export function validSyncValue(collection: SyncCollection, key: string, value: unknown): boolean {
  if (value === null) return collection !== 'preference' || (SYNC_PREFERENCE_KEYS as readonly string[]).includes(key);
  if (collection === 'preference') return preference(key, value);
  if (collection === 'favorite') return value === true;
  if (!isObject(value)) return false;
  if (collection === 'search') return key.length <= 50 && value.text === key && number(value.timestamp);
  if (collection === 'recent') return value.url === key && text(value.name, 300) && number(value.timestamp) && ['logo', 'group', 'tvgId', 'epg', 'sourceUrl'].every((field) => value[field] === undefined || text(value[field]));
  if (collection === 'progress') return value.key === key && number(value.position) && number(value.duration) && number(value.updatedAt);
  return value.id === key && text(value.sourceKey, 200) && text(value.vodId) && key === `${value.sourceKey}_${value.vodId}` && text(value.title, 1000) && ['episodeIndex', 'totalEpisodes'].every((field) => Number.isSafeInteger(value[field]) && number(value[field])) && ['playbackPosition', 'duration', 'timestamp'].every((field) => number(value[field])) && ['pic', 'sourceUrl'].every((field) => value[field] === undefined || text(value[field]));
}
export function validSyncRequest(value: unknown): value is SyncRequest {
  if (!isObject(value) || value.protocol !== SYNC_PROTOCOL || !text(value.accountId, 128) || !value.accountId || !Number.isSafeInteger(value.cursor) || !number(value.cursor) || !Array.isArray(value.mutations) || value.mutations.length > SYNC_BATCH_SIZE) return false;
  const keys = new Set<string>();
  return value.mutations.every((item) => {
    if (!isObject(item) || !text(item.id, 128) || !item.id || !(SYNC_COLLECTIONS as readonly unknown[]).includes(item.collection) || !text(item.key) || !item.key || !Number.isSafeInteger(item.baseVersion) || !number(item.baseVersion)) return false;
    const id = syncId(item.collection as SyncCollection, item.key as string);
    if (keys.has(id) || !validSyncValue(item.collection as SyncCollection, item.key as string, item.value)) return false;
    keys.add(id);
    try { return JSON.stringify(item.value).length <= 256_000; } catch { return false; }
  });
}
export function validSyncResponse(value: unknown): value is SyncResponse {
  if (!isObject(value) || value.protocol !== SYNC_PROTOCOL || !text(value.accountId, 128) || !Number.isSafeInteger(value.cursor) || !number(value.cursor) || typeof value.more !== 'boolean' || !Array.isArray(value.records) || !Array.isArray(value.results)) return false;
  const row = (entry: unknown) => isObject(entry) && (SYNC_COLLECTIONS as readonly unknown[]).includes(entry.collection) && text(entry.key) && Number.isSafeInteger(entry.version) && number(entry.version) && number(entry.updatedAt) && validSyncValue(entry.collection as SyncCollection, entry.key as string, entry.value);
  return value.records.length <= SYNC_PAGE_SIZE && value.results.length <= SYNC_BATCH_SIZE && value.records.every(row) && value.results.every((entry) => isObject(entry) && text(entry.id, 128) && typeof entry.accepted === 'boolean' && row(entry.record));
}
