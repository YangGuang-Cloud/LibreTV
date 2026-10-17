import { NextResponse } from 'next/server';
import { guardAdminRequest } from './admin-guard';
import { accountConfigured, accountMode } from './account-mode';
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export function guardAccountAdminRequest(req: Request) {
  const denied = guardAdminRequest(req);
  if (denied) return denied;
  if (!accountMode() || !accountConfigured()) return reply({ error: '请先配置并开启账号模式' }, 409);
  if (req.method !== 'GET') {
    if (req.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: '请求来源无效' }, 403);
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(process.env.BETTER_AUTH_URL!).origin) return reply({ error: '请求来源无效' }, 403);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: '请使用 JSON 请求' }, 415);
  }
  return null;
}

