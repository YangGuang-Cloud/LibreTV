import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { normalizeServerSources, readServerSources, saveServerSources, serverSourceMode, SourceRevisionConflict } from '@/lib/server-sources';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  if (!serverSourceMode()) return NextResponse.json({ error: '未开启服务器源管理模式' }, { status: 409 });
  try { return NextResponse.json(await readServerSources(), { headers }); }
  catch { return NextResponse.json({ error: '服务器源配置读取失败' }, { status: 500, headers }); }
}

export async function PUT(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  if (!serverSourceMode()) return NextResponse.json({ error: '未开启服务器源管理模式' }, { status: 409 });
  let sources;
  let revision;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object') throw new Error('请求格式错误');
    const fields = body as Record<string, unknown>;
    sources = normalizeServerSources(fields.sources);
    revision = fields.revision;
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw new Error('配置版本无效');
    for (const source of sources) {
      for (const url of [source.url, source.detail].filter((value): value is string => !!value)) {
        const verdict = await checkUpstreamAllowed(url);
        if (!verdict.ok) throw new Error(`${source.name}：${verdict.reason}`);
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '请求格式错误' }, { status: 400, headers });
  }
  try { return NextResponse.json(await saveServerSources(sources, revision), { headers }); }
  catch (error) {
    return NextResponse.json({ error: error instanceof SourceRevisionConflict ? error.message : '配置保存失败' }, {
      status: error instanceof SourceRevisionConflict ? 409 : 500, headers,
    });
  }
}
