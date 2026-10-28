import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { readViewerRecommendations } from '@/lib/content-profiles';
import { loadRecommendationFeed } from '@/lib/recommendation-feed';
import { validRecommendationID } from '@/lib/recommendation-config';
import type { DoubanItem } from '@/lib/types';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const cache = new Map<string, { until: number; items: DoubanItem[] }>();
export async function GET(req: Request) {
  const guarded = await guardRequest(req); if (guarded) return guarded;
  const params = new URL(req.url).searchParams;
  const sourceId = params.get('source'), feedId = params.get('feed');
  if (!validRecommendationID(sourceId) || !validRecommendationID(feedId)) return NextResponse.json({ error: '来源或分类编号无效' }, { status: 400, headers });
  try {
    const config = await readViewerRecommendations(req);
    const source = config.sources.find((source) => source.enabled && source.id === sourceId);
    const feed = source?.feeds?.find((feed) => feed.id === feedId);
    if (!feed) return NextResponse.json({ error: '推荐来源已变更，请刷新配置' }, { status: 404, headers });
    const key = `${config.revision}:${sourceId}:${feedId}`;
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return NextResponse.json({ items: cached.items }, { headers });
    const items = await loadRecommendationFeed(feed, req.signal);
    for (const [key, entry] of cache) if (entry.until <= Date.now()) cache.delete(key);
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { items, until: Date.now() + 300_000 });
    return NextResponse.json({ items }, { headers });
  } catch { return NextResponse.json({ error: '推荐内容暂时无法获取，请稍后重试或联系管理员测试接口' }, { status: 502, headers }); }
}
