import { NextResponse } from 'next/server';
import { guardAccountAdminRequest } from '@/lib/account-admin-guard';
import { getAccountAuth } from '@/lib/account-auth';
import { generateLicenses, listLicenses, revokeLicense, LicenseError } from '@/lib/account-licenses';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
async function handle(req: Request) {
  const denied = guardAccountAdminRequest(req); if (denied) return denied;
  try {
    const { database } = await getAccountAuth();
    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams, offset = Number(params.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new LicenseError('分页参数无效');
      return NextResponse.json(listLicenses(database, offset, params.get('id') || undefined), { headers });
    }
    const raw = await req.text(); if (raw.length > 4096) throw new LicenseError('请求过大', 413);
    let body; try { body = JSON.parse(raw); } catch { throw new LicenseError('请求格式无效'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LicenseError('请求格式无效');
    if (req.method === 'POST') return NextResponse.json({ codes: generateLicenses(database, body) }, { headers });
    revokeLicense(database, body.id); return NextResponse.json({ success: true }, { headers });
  } catch (error) { return NextResponse.json({ error: error instanceof LicenseError ? error.message : '授权码操作失败' }, { status: error instanceof LicenseError ? error.status : 500, headers }); }
}
export const GET = handle; export const POST = handle; export const PATCH = handle;
