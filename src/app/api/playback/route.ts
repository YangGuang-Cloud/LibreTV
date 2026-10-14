import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { signMediaURL } from '@/lib/auth';
import { isValidProxyUrl, isBlockedByDNS } from '@/lib/ssrf';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = guardRequest(req);
  if (denied) return denied;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError('无效请求', 400); }
  const target = (body as { url?: unknown } | null)?.url;
  if (typeof target !== 'string' || target.length > 8192 || !isValidProxyUrl(target)) return jsonError('无效视频地址', 400);
  if (await isBlockedByDNS(target)) return jsonError('不允许访问私有网络', 403);
  const expiresAt = Date.now() + 6 * 60 * 60 * 1000;
  const path = `/api/proxy?url=${encodeURIComponent(target)}&mediaExpires=${expiresAt}&mediaSignature=${signMediaURL(target, expiresAt)}`;
  return NextResponse.json({ path, expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
}
