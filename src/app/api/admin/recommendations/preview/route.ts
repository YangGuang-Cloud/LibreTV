import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { normalizeRecommendationFeed } from '@/lib/recommendation-config';
import { loadRecommendationFeed } from '@/lib/recommendation-feed';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(req: Request) {
  const guarded = guardAdminRequest(req); if (guarded) return guarded;
  let feed;
  try { feed = normalizeRecommendationFeed((await req.json()).feed); }
  catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : '分类配置无效' }, { status: 400, headers }); }
  try {
    const items = await loadRecommendationFeed(feed, req.signal);
    return NextResponse.json({ count: items.length, items: items.slice(0, 5) }, { headers });
  } catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : '测试失败' }, { status: 502, headers }); }
}
