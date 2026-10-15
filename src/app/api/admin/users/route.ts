import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { accountConfigured, accountMode } from '@/lib/account-mode';
import { AccountInputError, createAccountUser, listAccountUsers, updateAccountUser } from '@/lib/account-users';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
function guard(req: Request) {
  const denied = guardAdminRequest(req);
  if (denied) return denied;
  if (!accountMode() || !accountConfigured()) return reply({ error: '请先配置并开启账号模式' }, 409);
  if (req.method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(process.env.BETTER_AUTH_URL!).origin) return reply({ error: '请求来源无效' }, 403);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: '请使用 JSON 请求' }, 415);
  }
  return null;
}

export async function GET(req: Request) {
  const denied = guard(req); if (denied) return denied;
  const offset = Number(new URL(req.url).searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return reply({ error: '分页参数无效' }, 400);
  return reply(await listAccountUsers(offset));
}

async function mutate(req: Request) {
  const denied = guard(req); if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return reply({ error: '请求过大' }, 413);
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    body = data as Record<string, unknown>;
  } catch { return reply({ error: '请求格式无效' }, 400); }
  try {
    if (req.method === 'POST') await createAccountUser(body);
    else await updateAccountUser(body);
    return reply({ success: true });
  } catch (error) {
    if (error instanceof AccountInputError) return reply({ error: error.message }, error.status);
    // 不向客户端返回数据库语句或密码等框架内部错误。
    return reply({ error: '账号操作失败，请刷新列表后重试' }, 500);
  }
}

export const POST = mutate;
export const PATCH = mutate;
