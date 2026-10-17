import { NextResponse } from 'next/server';
import { guardAccountAdminRequest } from '@/lib/account-admin-guard';
import { AccountInputError, revealAccountPassword } from '@/lib/account-users';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
export async function POST(req: Request) {
  const denied = guardAccountAdminRequest(req); if (denied) return denied;
  try {
    const raw = await req.text();
    if (raw.length > 1024) return NextResponse.json({ error: '请求过大' }, { status: 413, headers });
    let body;
    try { body = JSON.parse(raw); } catch { throw new AccountInputError('请求格式无效'); }
    const password = await revealAccountPassword(body?.userId);
    return NextResponse.json({ password }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AccountInputError ? error.message : '密码读取失败' }, { status: error instanceof AccountInputError ? error.status : 500, headers });
  }
}
