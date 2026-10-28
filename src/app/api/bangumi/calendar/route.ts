import { legacyRecommendationAllowed } from '@/lib/content-profiles';
import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchBangumiCalendar } from '@/lib/bangumi';

export const runtime = 'nodejs';

/** Bangumi 每日放送（免 key）：服务端直连 + 缓存，作为首页推荐的备用数据源 */
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  if (!await legacyRecommendationAllowed(req)) return NextResponse.json({error:'主页内容已变更，请刷新内容配置'}, {status:403,headers:{'Cache-Control':'private, no-store'}});

  try {
    const days = await fetchBangumiCalendar();
    return NextResponse.json({
      days: Object.entries(days).map(([weekday, items]) => ({ weekday: Number(weekday), items })),
    });
  } catch (err) {
    console.warn('[bangumi/calendar] 上游请求失败:', err instanceof Error ? err.message : '未知错误');
    return NextResponse.json(
      { error: '暂时无法连接新番来源，请稍后重试或切换其他推荐来源。' },
      { status: 502 }
    );
  }
}
