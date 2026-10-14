import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { meaningfulEpisodeTitle } from './episode-title';
import { findAutomaticEpisodeMetadata, type EpisodeImport } from './episode-providers';
import type { SourceConfig, VideoDetail } from './types';

export interface EpisodeRecord {
  key: string;
  title: string;
  sourceKey: string;
  vodId: string;
  binding: string;
  manualTitles: string[];
  autoDisabled?: boolean;
  imported?: EpisodeImport;
  updatedAt: string;
}
export interface EpisodeSnapshot { record: EpisodeRecord | null; revision: string; stale: boolean }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const episodeRecordKey = (source: SourceConfig, id: string) => hash([source.key, source.url, id]);
export function episodeBinding(detail: VideoDetail): string {
  return hash([detail.videoInfo.title, detail.videoInfo.year, detail.episodes.map((url) => {
    try {
      const value = new URL(url);
      for (const key of [...value.searchParams.keys()]) {
        if (/^(?:token|sign|signed|signature|expires?|auth_key|timestamp|ts)$/i.test(key)) value.searchParams.delete(key);
      }
      value.searchParams.sort(); value.hash = '';
      return value.href;
    } catch { return url; }
  })]);
}
const filePath = () => path.join(process.env.SERVER_DATA_DIR || path.join(process.cwd(), '.data'), 'episode-metadata.json');
let writes: Promise<unknown> = Promise.resolve();
const lookups = new Map<string, Promise<void>>();
const attempted = new Map<string, number>();

async function readRecords(): Promise<EpisodeRecord[]> {
  try {
    const data = JSON.parse(await readFile(filePath(), 'utf8')) as { version?: number; records?: EpisodeRecord[] };
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > 2000 ||
        data.records.some((record) => !record || !/^[a-f0-9]{64}$/.test(record.key) || !Array.isArray(record.manualTitles))) {
      throw new Error('分集资料文件格式无效');
    }
    return data.records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function readEpisodeSnapshot(source: SourceConfig, id: string, detail: VideoDetail): Promise<EpisodeSnapshot> {
  const record = (await readRecords()).find((record) => record.key === episodeRecordKey(source, id)) ?? null;
  return { record, revision: hash(record), stale: !!record && record.binding !== episodeBinding(detail) };
}
export class EpisodeRevisionConflict extends Error {}

function storeRecord(source: SourceConfig, id: string, detail: VideoDetail, transform: (current: EpisodeRecord | null) => EpisodeRecord, revision?: string): Promise<EpisodeRecord> {
  const operation = writes.then(async () => {
    const records = await readRecords();
    const key = episodeRecordKey(source, id);
    const current = records.find((record) => record.key === key) ?? null;
    if (revision !== undefined && revision !== hash(current)) throw new EpisodeRevisionConflict('分集资料已被更新，请重新加载后编辑');
    const next = transform(current);
    next.key = key;
    next.binding = episodeBinding(detail);
    const result = [...records.filter((record) => record.key !== key), next];
    if (result.length > 2000) throw new Error('分集资料已达到 2000 部上限');
    const target = filePath();
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ version: 1, records: result }, null, 2), { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } finally { await unlink(temp).catch(() => {}); }
    return next;
  });
  writes = operation.catch(() => {});
  return operation;
}

function baseRecord(source: SourceConfig, id: string, detail: VideoDetail): EpisodeRecord {
  return { key: episodeRecordKey(source, id), sourceKey: source.key, vodId: id, title: detail.videoInfo.title ?? '',
    binding: episodeBinding(detail), manualTitles: detail.episodes.map(() => ''), updatedAt: new Date().toISOString() };
}

export function saveManualEpisodeTitles(source: SourceConfig, id: string, detail: VideoDetail, value: unknown, revision: string, autoDisabled?: boolean): Promise<EpisodeRecord> {
  if (!Array.isArray(value) || value.length !== detail.episodes.length || value.length > 5000 ||
      value.some((title) => typeof title !== 'string' || title.length > 300)) throw new Error('每集标题必须为文字，最多 300 字，数量须与剧集一致');
  return storeRecord(source, id, detail, (current) => ({
    ...(current?.binding === episodeBinding(detail) ? current : baseRecord(source, id, detail)),
    manualTitles: (value as string[]).map(meaningfulEpisodeTitle), updatedAt: new Date().toISOString(),
    ...(autoDisabled === undefined ? {} : { autoDisabled }),
  }), revision).then((record) => {
    if (autoDisabled === false) attempted.delete(`${record.key}:${record.binding}`);
    return record;
  });
}

export function clearImportedEpisodeTitles(source: SourceConfig, id: string, detail: VideoDetail, revision: string): Promise<EpisodeRecord> {
  return storeRecord(source, id, detail, (current) => {
    const next = { ...(current?.binding === episodeBinding(detail) ? current : baseRecord(source, id, detail)), autoDisabled: true, updatedAt: new Date().toISOString() };
    delete next.imported;
    return next;
  }, revision);
}

export function saveImportedEpisodeTitles(source: SourceConfig, id: string, detail: VideoDetail, imported: EpisodeImport, revision?: string): Promise<EpisodeRecord> {
  return storeRecord(source, id, detail, (current) => ({
    ...(current?.binding === episodeBinding(detail) ? current : baseRecord(source, id, detail)),
    imported, updatedAt: new Date().toISOString(),
  }), revision);
}

export function mergeEpisodeTitles(detail: VideoDetail, snapshot: EpisodeSnapshot): VideoDetail {
  const record = snapshot.stale ? null : snapshot.record;
  const origins: ('manual' | 'source' | 'metadata' | 'none')[] = [];
  const titles = detail.episodes.map((_, index) => {
    const manual = meaningfulEpisodeTitle(record?.manualTitles[index]);
    const source = meaningfulEpisodeTitle(detail.episodeTitles?.[index]);
    const metadata = meaningfulEpisodeTitle(record?.imported?.titles[index]);
    origins.push(manual ? 'manual' : source ? 'source' : metadata ? 'metadata' : 'none');
    // 保留源原有编号标签供后台判断集序；客户端已经会隐藏纯编号。
    return manual || source || metadata || detail.episodeTitles?.[index] || '';
  });
  const imported = record?.imported;
  return { ...detail, episodeTitles: titles, episodeTitleOrigins: origins,
    episodeAttributions: imported && origins.includes('metadata') ? [{ name: imported.candidate.provider === 'tvmaze' ? 'TVmaze (CC BY-SA)' : 'Bangumi', url: imported.candidate.url }] : [] };
}

/** 自动查询按影片和地址绑定去重；失败不阻塞播放，未匹配结果在本实例缓存一天。 */
export async function enrichEpisodeTitles(source: SourceConfig, id: string, detail: VideoDetail): Promise<VideoDetail> {
  let snapshot = await readEpisodeSnapshot(source, id, detail);
  const key = `${episodeRecordKey(source, id)}:${episodeBinding(detail)}`;
  if (process.env.EPISODE_METADATA_AUTO === 'false' || snapshot.stale || snapshot.record?.autoDisabled || snapshot.record?.imported ||
      detail.episodes.length < 2 || detail.episodes.every((_, index) => meaningfulEpisodeTitle(snapshot.record?.manualTitles[index]) || meaningfulEpisodeTitle(detail.episodeTitles?.[index]))) {
    return mergeEpisodeTitles(detail, snapshot);
  }
  if ((attempted.get(key) ?? 0) > Date.now()) return mergeEpisodeTitles(detail, snapshot);
  let lookup = lookups.get(key);
  if (!lookup && lookups.size < 3) {
    lookup = (async () => {
      let retryAfter = 24 * 60 * 60 * 1000;
      try {
        const result = await findAutomaticEpisodeMetadata(detail, AbortSignal.timeout(4000));
        if (result) await saveImportedEpisodeTitles(source, id, detail, result, snapshot.revision);
      } catch { retryAfter = 5 * 60 * 1000; /* 超时/并发保存时不覆盖，也不影响视频。 */ }
      finally {
        if (attempted.size >= 2000) attempted.delete(attempted.keys().next().value!);
        attempted.set(key, Date.now() + retryAfter);
        lookups.delete(key);
      }
    })();
    lookups.set(key, lookup);
  }
  if (lookup) await lookup;
  snapshot = await readEpisodeSnapshot(source, id, detail);
  return mergeEpisodeTitles(detail, snapshot);
}
