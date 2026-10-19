import { NextResponse } from 'next/server';
import { guardAccountAdminRequest } from '@/lib/account-admin-guard';
import { getAccountAuth } from '@/lib/account-auth';
import { AccountInputError } from '@/lib/account-users';
import { accountDetailQuery, readAccountDetail } from '@/lib/account-admin-detail';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
export async function GET(req: Request) {
  const denied = guardAccountAdminRequest(req); if (denied) return denied;
  try {
    const { userId, section, offset } = accountDetailQuery(new URL(req.url).searchParams);
    const { database } = await getAccountAuth();
    return NextResponse.json(readAccountDetail(database, userId, section, offset), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AccountInputError ? error.message : '账号详情读取失败，请稍后重试' },
      { status: error instanceof AccountInputError ? error.status : 500, headers });
  }
}
