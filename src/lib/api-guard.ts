import { accountMode } from './account-mode';
import { NextResponse } from 'next/server';
import { viewerConfigured, viewerSession } from './viewer-session';

/** API Route 共享守卫：未配置密码返回 503，未登录返回 401 */
export async function guardRequest(req: Request): Promise<NextResponse | null> {
  if (!viewerConfigured()) {
    return NextResponse.json(
      { error: '服务器尚未配置登录方式，请联系管理员' },
      { status: 503 }
    );
  }
  if (!await viewerSession(req)) {
    return NextResponse.json({ error: accountMode() ? '账号未登录或授权已到期，请登录或使用授权码续期' : '未登录' }, { status: 401 });
  }
  return null;
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
