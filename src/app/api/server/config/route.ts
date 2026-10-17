import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { readServerSources, serverSourceMode } from '@/lib/server-sources';

import { readRecommendations } from '@/lib/server-recommendations';

export const runtime = 'nodejs';

/** 原生客户端只获取源编号和显示信息，无须配置资源站地址。 */
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  if (!serverSourceMode()) return NextResponse.json({ error: '未开启服务器源管理模式' }, { status: 409 });
  try {
    const { sources, revision } = await readServerSources();
    return NextResponse.json({
      apiVersion: 1, sourceMode: 'server', revision,
      recommendations: await readRecommendations(),
      sources: sources.map(({ key, name, isAdult }) => ({ key, name, isAdult: isAdult === true })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: '服务器源配置读取失败' }, { status: 500 });
  }
}
