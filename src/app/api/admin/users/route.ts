import { NextResponse } from 'next/server';
import { guardAccountAdminRequest } from '@/lib/account-admin-guard';
import { AccountInputError, listAccountUsers, updateAccountUser } from '@/lib/account-users';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function GET(req: Request) {
  const denied = guardAccountAdminRequest(req); if (denied) return denied;
  const offset = Number(new URL(req.url).searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return reply({ error: '分页参数无效' }, 400);
  return reply(await listAccountUsers(offset));
}

async function mutate(req: Request) {
  const denied = guardAccountAdminRequest(req); if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return reply({ error: '请求过大' }, 413);
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    body = data as Record<string, unknown>;
  } catch { return reply({ error: '请求格式无效' }, 400); }
  try {
    if (req.method === 'POST') return reply({ error: '请生成授权码，由用户自行注册账号' }, 410);
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
