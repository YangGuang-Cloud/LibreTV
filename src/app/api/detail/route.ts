import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import type { SourceConfig } from '@/lib/types';
import { parseSourceConfig } from '@/lib/source-config';
import { resolveServerSources, serverSourceMode } from '@/lib/server-sources';

import { loadVideoDetail, DetailLoadError } from '@/lib/video-detail';
import { enrichEpisodeTitles } from '@/lib/episode-metadata';

export const runtime = 'nodejs';


function parseSource(raw: string | null): SourceConfig | null {
  if (!raw) return null;
  try {
    return parseSourceConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 视频详情：优先走列表接口 ?ac=videolist&ids=，
 * 拿不到播放地址时（部分源需要爬详情页）降级到 detail 页 HTML 提取。
 */
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').trim();
  let source = parseSource(url.searchParams.get('source'));
  if (serverSourceMode()) {
    try {
      const key = url.searchParams.get('sourceKey') || source?.key;
      source = key ? (await resolveServerSources([key]))[0] : null;
    } catch { source = null; }
  }
  const baseUrl = serverSourceMode() ? '' : (url.searchParams.get('baseUrl') || '').trim();

  if (!id || !/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
  }
  if (!source) {
    return NextResponse.json({ error: '无效的点播源配置' }, { status: 400 });
  }

  try {
    const raw = await loadVideoDetail(source, id, req.signal, baseUrl);
    let resolved = raw;
    if (serverSourceMode()) {
      try { resolved = await enrichEpisodeTitles(source, id, raw); }
      catch { /* 资料损坏或不可用时，影片依然可观看。 */ }
    }
    return NextResponse.json(resolved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取详情失败' },
      { status: err instanceof DetailLoadError ? err.status : 502 }
    );
  }
}
