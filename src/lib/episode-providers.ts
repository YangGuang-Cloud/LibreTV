import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { normalizeTitle } from './search-result-utils';
import type { VideoDetail } from './types';

export type EpisodeProvider = 'bangumi' | 'tvmaze';
export interface MetadataCandidate {
  provider: EpisodeProvider;
  id: number;
  title: string;
  originalTitle: string;
  year: string;
  url: string;
}
export interface EpisodeImport {
  candidate: MetadataCandidate;
  season: number;
  titles: string[];
}
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 300) : '';
const items = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

async function json(url: string, signal?: AbortSignal, body?: unknown): Promise<unknown> {
  const key = `episode-provider:${url}:${body ? JSON.stringify(body) : ''}`;
  const cached = getCache<unknown>(key);
  if (cached !== null && cached !== undefined) return cached;
  const res = await fetchUpstream(url, {
    signal, timeoutMs: 5000, retries: 0,
    headers: { 'User-Agent': 'LibreTV/episode-metadata (https://github.com/LibreSpark/LibreTV)', 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`节目资料暂不可用（${res.status}）`);
  const data = await res.json();
  setCache(key, data, 24 * 60 * 60 * 1000);
  return data;
}

function candidate(provider: EpisodeProvider, value: unknown): MetadataCandidate | null {
  const data = object(value);
  const id = data.id;
  if (!Number.isSafeInteger(id) || Number(id) <= 0) return null;
  const originalTitle = text(data.name);
  return {
    provider, id: Number(id), originalTitle,
    title: provider === 'bangumi' ? text(data.name_cn) || originalTitle : originalTitle,
    year: text(provider === 'bangumi' ? data.date : data.premiered).slice(0, 4),
    url: provider === 'bangumi' ? `https://bgm.tv/subject/${id}` : `https://www.tvmaze.com/shows/${id}`,
  };
}

export async function searchEpisodeMetadata(provider: EpisodeProvider, query: string, signal?: AbortSignal): Promise<MetadataCandidate[]> {
  if (provider === 'bangumi') {
    const result = object(await json('https://api.bgm.tv/v0/search/subjects?limit=10', signal, { keyword: query, filter: { type: [2, 6] } }));
    return items(result.data).map((data) => candidate(provider, data)).filter((data): data is MetadataCandidate => !!data).slice(0, 10);
  }
  const result = await json(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, signal);
  return items(result).map((data) => candidate(provider, object(data).show)).filter((data): data is MetadataCandidate => !!data).slice(0, 10);
}

/** 只接受完整的 1..N 正篇集序，不用数组顺序硬套特别篇或合并集。 */
export function alignEpisodeMetadata(episodes: { number: number; title: string }[], count: number): string[] {
  if (episodes.length !== count || count < 2) throw new Error('资料集数与播放源不一致，请改用手动填写');
  const byNumber = new Map<number, string>();
  for (const episode of episodes) {
    if (!Number.isInteger(episode.number) || episode.number < 1 || episode.number > count || byNumber.has(episode.number)) {
      throw new Error('资料含重复、特别篇或非连续集序，不能直接导入');
    }
    byNumber.set(episode.number, episode.title);
  }
  return Array.from({ length: count }, (_, i) => byNumber.get(i + 1) ?? '');
}

export async function importEpisodeMetadata(provider: EpisodeProvider, id: number, season: number, count: number, signal?: AbortSignal): Promise<EpisodeImport> {
  let show: MetadataCandidate | null;
  let episodes: { number: number; title: string }[];
  if (provider === 'bangumi') {
    show = candidate(provider, await json(`https://api.bgm.tv/v0/subjects/${id}`, signal));
    const result = object(await json(`https://api.bgm.tv/v0/episodes?subject_id=${id}&type=0&limit=100`, signal));
    if (Number(result.total) > 100) throw new Error('该条目超过 100 集，请手动编辑分集资料');
    episodes = items(result.data).filter((data) => object(data).type === 0).map((data) => {
      const item = object(data);
      return { number: Number(item.sort), title: text(item.name_cn) || text(item.name) };
    });
  } else {
    show = candidate(provider, await json(`https://api.tvmaze.com/shows/${id}`, signal));
    const result = await json(`https://api.tvmaze.com/shows/${id}/episodes`, signal);
    episodes = items(result).filter((data) => object(data).season === season && Number.isInteger(object(data).number)).map((data) => {
      const item = object(data);
      return { number: Number(item.number), title: text(item.name) };
    });
  }
  if (!show) throw new Error('节目资料格式无效');
  return { candidate: show, season, titles: alignEpisodeMetadata(episodes, count) };
}

export function sourceEpisodeOrderIsRegular(detail: VideoDetail): boolean {
  return detail.episodes.length > 1 && detail.episodes.every((_, i) => {
    const title = detail.episodeTitles?.[i]?.replace(/\s/g, '') ?? '';
    const match = /^第?0*(\d+)(?:集|话)?$/.exec(title);
    return !!match && Number(match[1]) === i + 1;
  });
}

export async function findAutomaticEpisodeMetadata(detail: VideoDetail, signal?: AbortSignal): Promise<EpisodeImport | null> {
  if (!sourceEpisodeOrderIsRegular(detail) || !/^\d{4}$/.test(detail.videoInfo.year ?? '') || !detail.videoInfo.title) return null;
  const title = detail.videoInfo.title;
  const anime = /动画|动漫|anime/i.test(detail.videoInfo.typeName ?? '');
  // TVmaze 的中文覆盖有限；不猜译名，不以模糊结果的第一条作为正确节目。
  const provider: EpisodeProvider = anime ? 'bangumi' : 'tvmaze';
  const seasonMatch = /(?:第\s*(\d+)\s*季|\bseason\s*(\d+)|\bs(\d+)\b)/i.exec(title);
  const season = Number(seasonMatch?.slice(1).find(Boolean) ?? 1);
  if (provider === 'tvmaze' && season > 1) return null;
  const query = provider === 'tvmaze' ? title.replace(/(?:第\s*\d+\s*季|\bseason\s*\d+|\bs\d+\b)/ig, '').trim() : title;
  const candidates = (await searchEpisodeMetadata(provider, query, signal)).filter((data) =>
    [data.title, data.originalTitle].some((value) => normalizeTitle(value) === normalizeTitle(query)) &&
    data.year === detail.videoInfo.year
  );
  if (candidates.length !== 1) return null;
  const result = await importEpisodeMetadata(provider, candidates[0].id, season, detail.episodes.length, signal);
  return result;
}
