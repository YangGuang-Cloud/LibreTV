import { NextResponse } from 'next/server';
import { accountConfigured, accountMode } from '@/lib/account-mode';
import { accountAuthHandler, getAccountSession } from '@/lib/account-auth';

export const runtime = 'nodejs';
const allowed = new Set(['POST /change-password']);

async function handle(req: Request) {
  // 注册、邮箱登录、改名、框架管理 API 均不对外开放，不能绕过后台创建账号。
  const route = new URL(req.url).pathname.slice('/api/auth'.length);
  if (!accountMode() || !allowed.has(`${req.method} ${route}`)) return NextResponse.json({ error: '接口不存在' }, { status: 404 });
  if (!accountConfigured()) return NextResponse.json({ error: '账号系统尚未配置' }, { status: 503 });
  if (Number(req.headers.get('content-length')) > 8192) return NextResponse.json({ error: '请求过大' }, { status: 413 });
  if (!await getAccountSession(req.headers)) return NextResponse.json({ error: '账号未登录或授权已到期，请先激活或续期' }, { status: 401 });
  return accountAuthHandler(req);
}

export const GET = handle;
export const POST = handle;
