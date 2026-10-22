import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { accountConfigured, accountMode } from '@/lib/account-mode';
import { getAccountAuth } from '@/lib/account-auth';
import { overviewAccounts } from '@/lib/admin-overview';
import { getServerMetrics } from '@/lib/server-metrics';
import type { AdminOverview } from '@/lib/admin-overview-model';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
export async function GET(req: Request) {
  const denied = guardAdminRequest(req); if (denied) return denied;
  try {
    const server = await getServerMetrics();
    let accounts: AdminOverview['accounts'] = null;
    let accountNotice: string | null = null;
    if (accountMode() && accountConfigured()) {
      try { accounts = overviewAccounts((await getAccountAuth()).database); }
      catch { accountNotice = '账号统计暂不可用'; }
    } else accountNotice = '开启账号模式后显示用户统计';
    return NextResponse.json({ accounts, accountNotice, server, version: process.env.APP_VERSION || 'unknown', buildId: process.env.APP_BUILD_ID || 'local' } satisfies AdminOverview, { headers });
  } catch { return NextResponse.json({ error: '总览读取失败，请稍后重试' }, { status: 503, headers }); }
}
