import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionFromCookieHeader } from '@/lib/auth';
import { getEnvSources } from '@/lib/env-sources';
import { getEnvLiveSources } from '@/lib/env-live-sources';
import { getEnvSubscriptions } from '@/lib/env-subscriptions';
import { getEnvRecommendSource } from '@/lib/env-recommend-source';
import { getEnvImageMode } from '@/lib/env-image-mode';
import { readServerSources, serverSourceMode } from '@/lib/server-sources';

export const runtime = 'nodejs';

/** 站点状态：客户端据此决定是否弹出登录框 / 提示管理员配置密码，并获取预置采集站与预置直播源 */
export async function GET(req: Request) {
  const passwordRequired = isPasswordConfigured();
  const verified = passwordRequired && sessionFromCookieHeader(req.headers.get('cookie'));
  const managed = serverSourceMode();
  let sources = verified ? getEnvSources() : [];
  if (verified && managed) {
    try { sources = (await readServerSources()).sources; }
    catch { return NextResponse.json({ error: '服务器源配置读取失败' }, { status: 500 }); }
  }
  return NextResponse.json({
    passwordRequired,
    verified,
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
    // 部署者通过 DEFAULT_RECOMMEND_SOURCE 指定的首页推荐数据源默认值（未配置时为 null）
    defaultRecommendSource: getEnvRecommendSource() ?? null,
    // 部署者通过 DEFAULT_IMAGE_MODE 指定的封面图加载方式默认值（未配置时为 null）
    defaultImageMode: getEnvImageMode() ?? null,
  }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
