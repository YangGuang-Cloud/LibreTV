import { NextResponse } from 'next/server';
import { adminPasswordConfigured, adminSessionFromRequest } from './admin-auth';

/** 后台使用独立会话，不接受观看会话或每次请求中的明文密码。 */
export function guardAdminRequest(req: Request): NextResponse | null {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!adminPasswordConfigured()) return NextResponse.json({ error: '请先配置 ADMIN_PASSWORD 管理员密码' }, { status: 503, headers });
  if (!adminSessionFromRequest(req)) return NextResponse.json({ error: '请登录管理后台' }, { status: 401, headers });
  return null;
}
