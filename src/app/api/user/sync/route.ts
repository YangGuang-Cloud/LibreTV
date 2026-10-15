import { NextResponse } from 'next/server';
import { accountConfigured, accountMode } from '@/lib/account-mode';
import { getAccountAuth, getAccountSession } from '@/lib/account-auth';
import { exchangeUserData, SyncRequestError } from '@/lib/server-user-sync';
import { validSyncRequest } from '@/lib/sync-model';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });
export async function POST(req: Request) {
  if (!accountMode()) return reply({ error: '请使用个人账号' }, 404);
  if (!accountConfigured()) return reply({ error: '账号系统尚未配置' }, 503);
  const session = await getAccountSession(req.headers);
  if (!session) return reply({ error: '请重新登录' }, 401);
  const origin = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(process.env.BETTER_AUTH_URL!).origin)) return reply({ error: '请求来源无效' }, 403);
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: '请使用 JSON 请求' }, 415);
  let value: unknown;
  try {
    const reader = req.body?.getReader();
    if (!reader) return reply({ error: '请求为空' }, 400);
    const decoder = new TextDecoder(); let size = 0; let raw = '';
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); return reply({ error: '请求过大' }, 413); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    value = JSON.parse(raw + decoder.decode());
  } catch { return reply({ error: '请求格式无效' }, 400); }
  if (!validSyncRequest(value)) return reply({ error: '同步数据格式或协议版本无效' }, 400);
  try {
    const { database } = await getAccountAuth();
    return reply(exchangeUserData(database, session.user.id, value));
  } catch (error) {
    if (error instanceof SyncRequestError) return reply({ error: error.message }, error.status);
    return reply({ error: '账号数据同步失败，请稍后重试' }, 500);
  }
}
