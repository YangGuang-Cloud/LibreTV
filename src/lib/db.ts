import Dexie, { type EntityTable } from 'dexie';
import type { SourceConfig } from './types';
import { accountClient, cachedAccountClient } from './account-data-client';
import { type AccountChange } from './account-data-client';
import { settingsMap } from './sync-settings';
// 仅类型引入：store.ts 运行时会引用本模块，反向只取类型不会形成运行时循环
import type { LiveProbeEntry } from './store';
import { isObject } from './sync-model';
export const PERSIST_KEY = 'libretv-settings'; // 只用于手动导入/导出的文件格式

/** IndexedDB 只保存设备缓存；个人数据由会话内管理器展示并通过接口同步。 */

export interface HistoryEntry {
  /** 主键：`${sourceKey}_${vodId}` */
  id: string;
  sourceKey: string;
  sourceUrl?: string;
  vodId: string;
  title: string;
  pic?: string;
  episodeIndex: number;
  totalEpisodes: number;
  playbackPosition: number;
  duration: number;
  timestamp: number;
}

export interface ProgressEntry {
  key: string; // `${sourceKey}_${vodId}_${episodeIndex}`
  position: number;
  duration: number;
  updatedAt: number;
}

export interface SearchHistoryEntry {
  text: string;
  timestamp: number;
}

export interface SegmentMetaEntry {
  /** Cache Storage 中的 key（归一化的分片绝对地址，或同源代理地址） */
  key: string;
  /** 所属剧集：`${source}:${vodId}:${episodeIndex}`，用于按集淘汰 */
  episodeKey: string;
  /** 片段序号（1 基，便于排查） */
  index: number;
  bytes: number;
  /** 预取时记录的真实耗时（毫秒），loader 命中缓存时合成进 hls.js stats 防 ABR 误判 */
  costMs: number;
  lastAccess: number;
}

export type DownloadStatus = 'waiting' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadTaskEntry {
  id: string;
  /** 播放页 m3u8 地址（直连或代理形式，入队时的原样） */
  url: string;
  title: string;
  /** 输出格式 */
  format: 'TS' | 'MP4';
  status: DownloadStatus;
  finished: number;
  total: number;
  errorNum: number;
  createdAt: number;
  updatedAt: number;
}

export function createClientDatabase(name: string) {
  const database = new Dexie(name) as Dexie & {
    liveProbe: EntityTable<LiveProbeEntry & { url: string }, 'url'>;
    segmentMeta: EntityTable<SegmentMetaEntry, 'key'>;
    downloads: EntityTable<DownloadTaskEntry, 'id'>;
  };

  database.version(1).stores({
    history: 'id, timestamp',
    progress: 'key, updatedAt',
    searchHistory: 'text, timestamp',
  });

  // v2 仅新增表；Dexie 会自动继承低版本的表结构
  database.version(2).stores({
    liveProbe: 'url',
  });

  // v3：视频片段缓存元数据（Cache Storage 存字节、这里存 LRU 索引）与离线下载任务
  database.version(3).stores({
    segmentMeta: 'key, episodeKey, lastAccess',
    downloads: 'id, createdAt',
  });

  database.version(4).stores({
    syncRows: 'id, collection',
    syncOutbox: 'id, collection',
    syncMeta: 'key',
  });
  // 清理旧版个人数据表，设备缓存和下载任务保持原样。
  database.version(5).stores({ history: null, progress: null, searchHistory: null, syncRows: null, syncOutbox: null, syncMeta: null });
  return database;
}

export type ClientDatabase = ReturnType<typeof createClientDatabase>;
export let db = createClientDatabase('libretv');

/** 在挂载业务组件前切换设备缓存和下载任务所属的账号。 */
export function setClientDataScope(userId: string | null, accounts: boolean): void {
  const scope = accounts ? (userId || 'guest') : '';
  const name = scope ? `libretv-account-${scope}` : 'libretv';
  if (db.name === name) return;
  db.close();
  db = createClientDatabase(name);
}

export const MAX_HISTORY = 100;
export const MAX_SEARCH_HISTORY = 10;

export function getHistory(): HistoryEntry[] {
  return (cachedAccountClient()?.values<HistoryEntry>('history') || []).sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_HISTORY);
}
export function getSearchHistory(): SearchHistoryEntry[] {
  return (cachedAccountClient()?.values<SearchHistoryEntry>('search') || []).sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_SEARCH_HISTORY);
}
export async function getProgress(key: string): Promise<ProgressEntry | undefined> {
  const client = accountClient();
  void client.refresh(false).catch(() => {});
  return client.get<ProgressEntry>('progress', key);
}
export async function upsertHistory(entry: Omit<HistoryEntry, 'id'>): Promise<void> {
  await accountClient().write((client) => {
    const id = `${entry.sourceKey}_${entry.vodId}`;
    const existing = client.get<HistoryEntry>('history', id);
    const sameEpisode = existing?.episodeIndex === entry.episodeIndex;
    return [{ collection: 'history', key: id, value: { ...entry, id,
      playbackPosition: entry.playbackPosition > 0 ? entry.playbackPosition : sameEpisode ? existing?.playbackPosition ?? 0 : 0,
      duration: entry.duration || (sameEpisode ? existing?.duration : 0) || 0, timestamp: Date.now(),
    } }];
  });
}
export async function updateHistoryProgress(sourceKey: string, vodId: string, position: number, duration: number): Promise<void> {
  await accountClient().write((client) => {
    const id = `${sourceKey}_${vodId}`;
    const existing = client.get<HistoryEntry>('history', id);
    if (!existing || (Math.abs(existing.playbackPosition - position) < 2 && Math.abs(existing.duration - duration) < 2)) return [];
    return [{ collection: 'history', key: id, value: { ...existing, playbackPosition: position, duration, timestamp: Date.now() } }];
  });
}
export async function removeHistory(sourceKey: string, vodId: string): Promise<void> {
  await accountClient().write([{ collection: 'history', key: `${sourceKey}_${vodId}`, value: null }]);
}
export async function clearAllHistory(): Promise<void> {
  await accountClient().clear(['history', 'progress']);
}
export function progressKeyOf(sourceKey: string, vodId: string, episodeIndex: number): string { return `${sourceKey}_${vodId}_${episodeIndex}`; }
export async function saveProgress(sourceKey: string, vodId: string, episodeIndex: number, position: number, duration: number): Promise<void> {
  if (!Number.isFinite(duration) || !Number.isFinite(position) || !duration || position < 1) return;
  const key = progressKeyOf(sourceKey, vodId, episodeIndex);
  await accountClient().write([{ collection: 'progress', key, value: { key, position, duration, updatedAt: Date.now() } }]);
}
export async function clearProgress(sourceKey: string, vodId: string, episodeIndex: number): Promise<void> {
  await accountClient().write([{ collection: 'progress', key: progressKeyOf(sourceKey, vodId, episodeIndex), value: null }]);
}
export async function addSearchHistory(text: string): Promise<void> {
  const key = text.trim().slice(0, 50);
  if (key) await accountClient().write([{ collection: 'search', key, value: { text: key, timestamp: Date.now() } }]);
}
export async function removeSearchHistory(text: string): Promise<void> { await accountClient().write([{ collection: 'search', key: text, value: null }]); }
export async function clearSearchHistory(): Promise<void> {
  await accountClient().write((client) => client.rows().filter((row) => row.collection === 'search' && row.value !== null).map((row) => ({ collection: 'search', key: row.key, value: null })));
}
export async function restoreSearchHistory(entries: SearchHistoryEntry[]): Promise<void> {
  await accountClient().write(entries.map((entry) => ({ collection: 'search', key: entry.text, value: entry })));
}

/** 移除旧的自动持久化副本，保留视频缓存、下载任务以及主题等设备设置。 */
export async function clearObsoletePersonalStorage() {
  for (const key of Object.keys(localStorage)) if (key === PERSIST_KEY || key.startsWith(`${PERSIST_KEY}:account:`)) localStorage.removeItem(key);
  for (const name of await Dexie.getDatabaseNames()) {
    if (name !== 'libretv' && !name.startsWith('libretv-account-')) continue;
    const database = name === db.name ? db : createClientDatabase(name);
    try { await database.open(); } finally { if (database !== db) database.close(); }
  }
}

// —— 直播测活缓存（TTL 过滤由调用方负责，本层只管存取） ——

export async function loadLiveProbeResults(): Promise<Record<string, LiveProbeEntry>> {
  const rows = await db.liveProbe.toArray();
  const out: Record<string, LiveProbeEntry> = {};
  for (const r of rows) out[r.url] = r;
  return out;
}

export async function saveLiveProbeResults(entries: Record<string, LiveProbeEntry>): Promise<void> {
  const rows = Object.entries(entries).map(([url, e]) => ({ ...e, url }));
  if (rows.length > 0) await db.liveProbe.bulkPut(rows);
}

export async function clearLiveProbeResultsDb(): Promise<void> {
  await db.liveProbe.clear();
}

// —— 配置导入导出（兼容旧版 LibreTV-Settings JSON 结构的导出格式） ——

export async function exportConfig(): Promise<string> {
  const client = accountClient(); await client.refresh();
  const state: Record<string, unknown> = {};
  for (const row of client.rows()) if (row.collection === 'preference' && row.value !== null) state[row.key] = row.value;
  state.liveFavorites = client.rows().filter((row) => row.collection === 'favorite' && row.value === true).map((row) => row.key);
  state.liveRecent = client.values('recent');
  return JSON.stringify({ name: 'LibreTV-Settings', time: String(Date.now()), cfgVer: '3.0.0', data: {
    [PERSIST_KEY]: JSON.stringify({ state, version: 2 }), viewingHistory: JSON.stringify(client.values('history')),
    playbackProgress: JSON.stringify(client.values('progress')), searchHistory: JSON.stringify(client.values('search')),
  } });
}
export async function importConfig(content: string): Promise<void> {
  const config: unknown = JSON.parse(content);
  if (!isObject(config) || config.name !== 'LibreTV-Settings' || !isObject(config.data)) throw new Error('配置文件格式不正确');
  const changes: AccountChange[] = [];
  const data = config.data;
  if (typeof data[PERSIST_KEY] === 'string') {
    const settings = JSON.parse(data[PERSIST_KEY]);
    changes.push(...settingsMap(settings.state).values());
  }
  if (typeof data.viewingHistory === 'string') {
    const history: unknown = JSON.parse(data.viewingHistory);
    if (!Array.isArray(history)) throw new Error('历史格式不正确');
    for (const item of history.slice(0, MAX_HISTORY)) {
      if (!isObject(item)) throw new Error('历史格式不正确');
      const sourceKey = String(item.sourceKey || item.sourceCode || item.sourceName || '');
      const vodId = String(item.vodId || item.vod_id || '');
      if (!sourceKey || !vodId) continue;
      const key = `${sourceKey}_${vodId}`;
      changes.push({ collection: 'history', key, value: {
        id: key, sourceKey, vodId, title: String(item.title || '未知视频'),
        episodeIndex: item.episodeIndex ?? 0, totalEpisodes: item.totalEpisodes ?? (Array.isArray(item.episodes) ? item.episodes.length : 0),
        playbackPosition: item.playbackPosition ?? 0, duration: item.duration ?? 0, timestamp: item.timestamp ?? Date.now(),
        ...(typeof item.pic === 'string' ? { pic: item.pic } : {}), ...(typeof item.sourceUrl === 'string' ? { sourceUrl: item.sourceUrl } : {}),
      } });
    }
  }
  for (const [field, collection, keyField] of [['playbackProgress', 'progress', 'key'], ['searchHistory', 'search', 'text']] as const) {
    if (typeof data[field] !== 'string') continue;
    const rows: unknown = JSON.parse(data[field]);
    if (!Array.isArray(rows)) throw new Error('记录格式不正确');
    for (const row of rows) {
      if (!isObject(row) || typeof row[keyField] !== 'string') throw new Error('记录格式不正确');
      changes.push({ collection, key: row[keyField], value: row });
    }
  }
  await accountClient().write(changes);
}
export type { SourceConfig };
