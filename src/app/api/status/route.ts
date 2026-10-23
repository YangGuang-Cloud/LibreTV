import { NextResponse } from 'next/server';
import { viewerConfigured, viewerSession } from '@/lib/viewer-session';
import { accountMode } from '@/lib/account-mode';
import { getEnvSources } from '@/lib/env-sources';
import { getEnvLiveSources } from '@/lib/env-live-sources';
import { getEnvSubscriptions } from '@/lib/env-subscriptions';
import { publicRecommendations, legacyRecommendationDefault } from '@/lib/recommendation-config';
import { readRecommendations } from '@/lib/server-recommendations';
import { getEnvImageMode } from '@/lib/env-image-mode';
import { readServerSources, serverSourceMode } from '@/lib/server-sources';

export const runtime = 'nodejs';

/** 站点状态：客户端据此决定是否弹出登录框 / 提示管理员配置密码，并获取预置采集站与预置直播源 */
export async function GET(req: Request) {
  const passwordRequired = viewerConfigured();
  const { getAccountSession } = accountMode() && passwordRequired ? await import('@/lib/account-auth') : { getAccountSession: null };
  const session = getAccountSession ? await getAccountSession(req.headers, true) : null;
  const authorization = session ? (await import('@/lib/account-licenses')).accountAccess((await (await import('@/lib/account-auth')).getAccountAuth()).database, session.user.id) : null;
  const verified = accountMode() ? !!session && authorization?.state === 'active' : await viewerSession(req);
  const managed = serverSourceMode();
  let sources = verified ? getEnvSources() : [];
  if (verified && managed) {
    try { sources = (await readServerSources()).sources; }
    catch { return NextResponse.json({ error: '服务器源配置读取失败' }, { status: 500 }); }
  }
  let recommendations;
  if (verified) {
    try { recommendations = await readRecommendations(); }
    catch { return NextResponse.json({ error: '推荐配置读取失败' }, { status: 500 }); }
  }
  return NextResponse.json({
    passwordRequired,
    verified,
    authMode: accountMode() ? 'account' : 'password',
    authorization,
    registrationRequiresCode: accountMode(),
    user: session ? { id: session.user.id, username: session.user.username, name: session.user.name } : null,
    sourceMode: managed ? 'server' : 'client',
    // 构建时由 next.config.ts 从 package.json 注入
    version: process.env.APP_VERSION || 'dev',
    buildId: process.env.APP_BUILD_ID || 'local',
    // 部署者通过 DEFAULT_SOURCES 预置的采集站
    defaultSources: sources,
    // 部署者通过 DEFAULT_LIVE_SOURCES 预置的直播源（M3U 订阅）
    defaultLiveSources: verified ? getEnvLiveSources() : [],
    // 部署者通过 DEFAULT_SUBSCRIPTIONS 预置的 SourceList 订阅链接
    defaultSubscriptions: verified && !managed ? getEnvSubscriptions() : [],
    // 保留旧客户端默认项字段；新客户端同时读取完整的推荐配置。
    defaultRecommendSource: recommendations ? legacyRecommendationDefault(recommendations) : null,
    recommendations: recommendations ? publicRecommendations(recommendations) : null,
    // 部署者通过 DEFAULT_IMAGE_MODE 指定的封面图加载方式默认值（未配置时为 null）
    defaultImageMode: getEnvImageMode() ?? null,
  }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
