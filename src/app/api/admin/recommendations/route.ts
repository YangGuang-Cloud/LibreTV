import { readAdminRecommendations, writeAdminRecommendations } from '@/lib/admin-profile-config';
import { ContentProfileError } from '@/lib/content-profiles';
import { NextResponse } from 'next/server';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { guardAdminRequest } from '@/lib/admin-guard';
import { normalizeRecommendationConfig } from '@/lib/recommendation-config';
import { RecommendationRevisionConflict } from '@/lib/server-recommendations';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  try { return NextResponse.json(await readAdminRecommendations(req), { headers }); }
  catch (e) { return NextResponse.json({ error: e instanceof ContentProfileError ? e.message : '推荐配置读取失败' }, { status: e instanceof ContentProfileError ? e.status : 500, headers }); }
}
export async function PUT(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  let config, revision;
  try {
    const body = await req.json();
    config = normalizeRecommendationConfig(body);
    for (const source of config.sources) for (const feed of source.feeds ?? []) for (const url of [feed.url!, ...(feed.fallbackUrls ?? [])]) {
      const verdict = await checkUpstreamAllowed(url);
      if (!verdict.ok) throw new Error(`${source.name} / ${feed.name}：接口地址不可访问（${verdict.reason}）`);
    }
    revision = body.revision;
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw new Error('配置版本无效');
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '请求格式错误' }, { status: 400, headers });
  }
  try { return NextResponse.json(await writeAdminRecommendations(req, config, revision), { headers }); }
  catch (error) {
    const conflict = error instanceof RecommendationRevisionConflict;
    return NextResponse.json({ error: error instanceof ContentProfileError || conflict ? error.message : '推荐配置保存失败' }, { status: error instanceof ContentProfileError ? error.status : conflict ? 409 : 500, headers });
  }
}
