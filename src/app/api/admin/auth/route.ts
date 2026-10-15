import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE, adminPasswordConfigured, adminSessionFromRequest, checkAdminPassword, secureCookie, signAdminSession } from '@/lib/admin-auth';
import { checkRateLimit, clearRateLimit } from '@/lib/auth';
import { serverSourceMode } from '@/lib/server-sources';
import { accountConfigured, accountMode } from '@/lib/account-mode';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  return NextResponse.json({
    configured: adminPasswordConfigured(), verified: adminSessionFromRequest(req), sourceMode: serverSourceMode() ? 'server' : 'client',
    accountMode: accountMode(), accountConfigured: accountConfigured(),
  }, { headers });
}

export async function POST(req: Request) {
  if (!adminPasswordConfigured()) return NextResponse.json({ error: '请先配置 ADMIN_PASSWORD 管理员密码' }, { status: 503, headers });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const rateKey = `admin:${ip}`;
  if (!checkRateLimit(rateKey)) return NextResponse.json({ error: '尝试次数过多，请 10 分钟后再试' }, { status: 429, headers });
  let password: string;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || typeof (body as { password?: unknown }).password !== 'string') throw new Error();
    password = (body as { password: string }).password;
    if (password.length > 1024) throw new Error();
  } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400, headers }); }
  if (!checkAdminPassword(password)) return NextResponse.json({ error: '管理员密码错误' }, { status: 401, headers });
  clearRateLimit(rateKey);
  const { token, expiresAt } = signAdminSession();
  const res = NextResponse.json({ success: true }, { headers });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true, secure: secureCookie(req), sameSite: 'strict', path: '/api/admin',
    maxAge: Math.floor((expiresAt - Date.now()) / 1000),
  });
  return res;
}

export async function DELETE(req: Request) {
  const res = NextResponse.json({ success: true }, { headers });
  res.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true, secure: secureCookie(req), sameSite: 'strict', path: '/api/admin', maxAge: 0,
  });
  return res;
}
