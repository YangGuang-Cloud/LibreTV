import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { getSourceAdapter } from '@/lib/source-adapters';
import { parseSourceConfig } from '@/lib/source-config';
import { resolveServerSources, serverSourceMode } from '@/lib/server-sources';
import type { SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

/** 点播源探活：以搜索 "test" 的响应耗时与结果量衡量可用性 */
export async function POST(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  let source: SourceConfig;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    const fields = body as Record<string, unknown>;
    if (serverSourceMode()) {
      // Server configuration is authoritative, including adapter type. Older clients may send only a URL.
      const sources = await resolveServerSources(undefined, req);
      const found = typeof fields.sourceKey === 'string'
        ? sources.find((item) => item.key === fields.sourceKey)
        : sources.find((item) => typeof fields.url === 'string' && item.url === fields.url.trim().replace(/\/+$/, ''));
      if (!found) return NextResponse.json({ error: '源已更新，请刷新源列表' }, { status: 400 });
      source = found;
    } else {
      const parsed = parseSourceConfig({ key: 'test', name: 'test', url: fields.url, adapter: fields.adapter });
      if (!parsed) return NextResponse.json({ error: '无效的源配置或接口类型' }, { status: 400 });
      source = parsed;
    }
  } catch {
    return NextResponse.json({ error: '请求格式或源配置错误' }, { status: 400 });
  }

  const verdict = await checkUpstreamAllowed(source.url);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, ms: 0, error: verdict.reason });
  }

  const start = Date.now();
  try {
    const page = await getSourceAdapter(source).searchPage(source, 'test', 1, { timeoutMs: 6000, signal: req.signal });
    return NextResponse.json({ ok: true, ms: Date.now() - start, count: page.list.length });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? '超时' : err.message) : '请求失败',
    });
  }
}
