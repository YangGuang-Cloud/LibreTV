import { NextResponse } from 'next/server';
import { accountConfigured, accountMode } from '@/lib/account-mode';
import { getAccountAuth, getAccountSession } from '@/lib/account-auth';
import { saveAccountActivity, validActivityReport } from '@/lib/account-activity';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });
export async function POST(req: Request) {
  if (!accountMode() || !accountConfigured()) return reply({ error: '账号统计不可用' }, 404);
  const origin = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(process.env.BETTER_AUTH_URL!).origin)) return reply({ error: '请求来源无效' }, 403);
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: '请使用 JSON 请求' }, 415);
  const session = await getAccountSession(req.headers);
  if (!session) return reply({ error: '请重新登录' }, 401);
  try {
    const reader = req.body?.getReader(); if (!reader) return reply({ error: '请求为空' }, 400);
    let raw = ''; let size = 0; const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2048) { await reader.cancel(); return reply({ error: '请求过大' }, 413); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    const value: unknown = JSON.parse(raw + decoder.decode());
    if (!validActivityReport(value)) return reply({ error: '统计数据无效' }, 400);
    const { database } = await getAccountAuth();
    saveAccountActivity(database, session.user.id, session.session.id, value);
    return reply({ success: true });
  } catch { return reply({ error: '统计暂不可用' }, 400); }
}
