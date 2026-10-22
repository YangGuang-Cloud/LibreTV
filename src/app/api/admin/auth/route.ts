import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE, ADMIN_REMEMBER_MS, adminPasswordConfigured, adminSessionDetails, adminUsername, checkAdminPassword, secureCookie, signAdminSession } from '@/lib/admin-auth';
import { checkRateLimit, clearRateLimit } from '@/lib/auth';
import { serverSourceMode } from '@/lib/server-sources';
import { accountConfigured, accountMode } from '@/lib/account-mode';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
function setSessionCookie(res: NextResponse, req: Request, token: string, expiresAt: number, remember: boolean) {
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true, secure: secureCookie(req), sameSite: 'strict', path: '/api/admin',
    ...(remember ? { maxAge: Math.floor((expiresAt - Date.now()) / 1000) } : {}),
  });
}
function invalidOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const url = new URL(req.url);
  const protocol = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || url.host;
  let expected = url.origin;
  try { expected = accountConfigured() ? new URL(process.env.BETTER_AUTH_URL!).origin : new URL(`${protocol}://${host}`).origin; }
  catch { return true; }
  return req.headers.get('sec-fetch-site') === 'cross-site' || !!origin && origin !== expected;
}
export async function GET(req: Request) {
  const session = adminSessionDetails(req);
  // Renew remembered sessions at most once per day when the console is opened.
  const renewal = session?.remember && session.expiresAt - Date.now() < ADMIN_REMEMBER_MS - 86400_000 ? signAdminSession(true) : null;
  const res = NextResponse.json({
    configured: adminPasswordConfigured(), verified: !!session, sourceMode: serverSourceMode() ? 'server' : 'client',
    accountMode: accountMode(), accountConfigured: accountConfigured(),
    user: session ? { username: session.username, name: '管理员' } : null,
    remember: session?.remember ?? false, expiresAt: renewal?.expiresAt ?? session?.expiresAt ?? null,
  }, { headers });
  if (renewal) setSessionCookie(res, req, renewal.token, renewal.expiresAt, true);
  return res;
}

export async function POST(req: Request) {
  if (invalidOrigin(req)) return NextResponse.json({ error: '请求来源无效' }, { status: 403, headers });
  if (!adminPasswordConfigured()) return NextResponse.json({ error: '请先配置 ADMIN_PASSWORD 管理员密码' }, { status: 503, headers });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const rateKey = `admin:${ip}`;
  if (!checkRateLimit(rateKey)) return NextResponse.json({ error: '尝试次数过多，请 10 分钟后再试' }, { status: 429, headers });
  let password: string; let username: string; let remember: boolean;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object') throw new Error();
    const data = body as Record<string, unknown>;
    if (typeof data.password !== 'string' || data.password.length > 1024) throw new Error();
    if (data.username !== undefined && (typeof data.username !== 'string' || data.username.length > 128)) throw new Error();
    if (data.remember !== undefined && typeof data.remember !== 'boolean') throw new Error();
    password = data.password;
    username = typeof data.username === 'string' ? data.username.trim() : adminUsername();
    remember = data.remember === undefined ? true : data.remember as boolean;
  } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400, headers }); }
  if (!checkAdminPassword(password) || username.toLowerCase() !== adminUsername().toLowerCase()) return NextResponse.json({ error: '账号或密码错误' }, { status: 401, headers });
  clearRateLimit(rateKey);
  const { token, expiresAt } = signAdminSession(remember);
  const res = NextResponse.json({ success: true, user: { username: adminUsername(), name: '管理员' }, remember, expiresAt }, { headers });
  setSessionCookie(res, req, token, expiresAt, remember);
  return res;
}

export async function DELETE(req: Request) {
  if (invalidOrigin(req)) return NextResponse.json({ error: '请求来源无效' }, { status: 403, headers });
  const res = NextResponse.json({ success: true }, { headers });
  res.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true, secure: secureCookie(req), sameSite: 'strict', path: '/api/admin', maxAge: 0,
  });
  return res;
}
