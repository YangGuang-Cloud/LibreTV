import { NextResponse } from 'next/server';
import { SESSION_COOKIE, checkRateLimit, sessionFromCookieHeader, signSession, checkPassword, clearRateLimit, isPasswordConfigured } from '@/lib/auth';
import { accountConfigured, accountMode } from '@/lib/account-mode';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (accountMode()) return accountRequest(req, '/sign-in/username');
  if (!isPasswordConfigured()) {
    return NextResponse.json(
      { success: false, error: '服务器未设置 PASSWORD 环境变量，请联系管理员配置' },
      { status: 503 }
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: '尝试次数过多，请 10 分钟后再试' },
      { status: 429 }
    );
  }

  let password = '';
  try {
    const body = (await req.json()) as { password?: string };
    password = String(body.password ?? '');
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ success: false, error: '密码错误' }, { status: 401 });
  }

  clearRateLimit(ip);
  const { token, expiresAt } = signSession();
  const res = NextResponse.json({ success: true });
  // Cookie Secure 策略：COOKIE_SECURE 环境变量显式覆盖；否则按 x-forwarded-proto 推导。
  // 不能依赖 req.url——Next.js Route Handler 中它是内部转发地址，并非用户侧的原始协议。
  const secure = process.env.COOKIE_SECURE === 'true'
    ? true
    : process.env.COOKIE_SECURE === 'false'
      ? false
      : (req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http') === 'https';
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.floor((expiresAt - Date.now()) / 1000),
    path: '/',
  });
  return res;
}

/** GET：查询当前会话状态 */
export async function GET(req: Request) {
  if (accountMode()) {
    if (!accountConfigured()) return NextResponse.json({ success: true, verified: false });
    const { getAccountSession } = await import('@/lib/account-auth');
    const session = await getAccountSession(req.headers);
    return NextResponse.json({ success: true, verified: !!session }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const verified = sessionFromCookieHeader(req.headers.get('cookie'));
  return NextResponse.json({ success: true, verified });
}

/** DELETE：登出 */
export async function DELETE(req: Request) {
  if (accountMode()) return accountRequest(req, '/sign-out');
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' });
  return res;
}

async function accountRequest(req: Request, path: string) {
  if (!accountConfigured()) return NextResponse.json({ error: '账号系统尚未配置，请联系管理员' }, { status: 503 });
  if (req.method === 'POST' && !req.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: '请使用 JSON 请求' }, { status: 415 });
  const raw = path === '/sign-out' ? '{}' : await req.text();
  if (raw.length > 4096) return NextResponse.json({ error: '请求过大' }, { status: 413 });
  const { accountAuthHandler } = await import('@/lib/account-auth');
  const headers = new Headers(req.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  const response = await accountAuthHandler(new Request(new URL(`/api/auth${path}`, process.env.BETTER_AUTH_URL), {
    method: 'POST', headers, body: raw,
  }));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
