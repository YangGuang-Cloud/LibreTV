import { fetchUpstreamWithMeta } from './fetch-utils';
import type { RecommendationFeed, RecommendationMapping } from './recommendation-config';
import type { DoubanItem } from './types';

function values(root: unknown, path: string): unknown[] {
  if (!path) return [root];
  let nodes = [root];
  for (const part of path.split('.')) {
    const next: unknown[] = [];
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      if (part === '*') next.push(...Object.values(node).slice(0, 1000));
      else if (Object.hasOwn(node, part)) next.push((node as Record<string, unknown>)[part]);
      if (next.length > 5000) throw new Error('数据列表过大，请缩小列表路径');
    }
    nodes = next;
  }
  return nodes;
}
function field(root: unknown, path: string): string {
  if (!path) return '';
  for (const candidate of path.split('|')) {
    const value = values(root, candidate)[0];
    if ((typeof value === 'string' && value.trim()) || typeof value === 'number') return String(value).trim();
  }
  return '';
}
export function parseRecommendationFeed(raw: unknown, mapping: RecommendationMapping, baseUrl: string): DoubanItem[] {
  if (mapping.filterPath) {
    if (!Array.isArray(raw)) throw new Error('分组筛选需要顶层数组');
    raw = raw.filter((group) => field(group, mapping.filterPath!) === mapping.filterValue);
  }
  if (Array.isArray(raw) && !raw.length) return [];
  let nodes: unknown[] = [];
  for (const path of mapping.listPath.split('|')) {
    const found = values(raw, path);
    if (found.some(Array.isArray) || (path.includes('*') && found.length)) { nodes = found; break; }
  }
  if (!nodes.length) throw new Error('找不到影片列表，请检查列表路径是否指向数组');
  const list = nodes.flatMap((node) => Array.isArray(node) ? node : [node]);
  const items: DoubanItem[] = [];
  const seen = new Set<string>();
  for (const entry of list.slice(0, 1000)) {
    const title = field(entry, mapping.titlePath).slice(0, 300);
    const cover = field(entry, mapping.coverPath);
    if (!title || !cover) continue;
    let url: URL;
    try { url = new URL(cover, baseUrl); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
    if (mapping.httpsCover) url.protocol = 'https:';
    const id = field(entry, mapping.idPath).slice(0, 200) || title;
    if (seen.has(id)) continue;
    seen.add(id);
    const rating = field(entry, mapping.ratingPath).slice(0, 20);
    items.push({ id, title, cover: url.href, ...(rating && rating !== '0' ? { rating } : {}) });
    if (items.length >= 100) break;
  }
  if (list.length && !items.length) throw new Error('已取得数据，但没有可显示的片名和海报，请检查字段对应关系');
  return items;
}
const MAX_BYTES = 2 * 1024 * 1024;
async function readJson(res: Response): Promise<unknown> {
  if (Number(res.headers.get('content-length')) > MAX_BYTES) { await res.body?.cancel(); throw new Error('接口数据超过 2 MB'); }
  if (!res.body) throw new Error('接口返回内容为空');
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('接口数据超过 2 MB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('接口未返回有效 JSON'); }
}
export async function loadRecommendationFeed(feed: RecommendationFeed, signal?: AbortSignal): Promise<DoubanItem[]> {
  let error: unknown;
  for (const url of [feed.url!, ...(feed.fallbackUrls ?? [])]) {
    signal?.throwIfAborted();
    try {
      const result = await fetchUpstreamWithMeta(url, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), timeoutMs: 12_000,
        headers: { Accept: 'application/json', Referer: new URL(url).origin + '/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Luna12TV/2.16' },
      });
      if (!result.res.ok) { await result.res.body?.cancel(); throw new Error(`接口响应异常（${result.res.status}）`); }
      return parseRecommendationFeed(await readJson(result.res), feed.mapping!, result.finalUrl);
    } catch (cause) { error = cause; }
  }
  // 网络错误可能包含接口查询令牌，不将底层异常下发给观看端。
  if (error instanceof Error && /^(接口|找不到影片列表|列表路径|已取得数据|分组筛选|数据列表)/.test(error.message)) throw error;
  throw new Error('无法获取推荐数据，请检查接口地址和服务器网络');
}
