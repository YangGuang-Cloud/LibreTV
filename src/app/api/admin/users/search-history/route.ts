import { guardAccountAdminRequest } from '@/lib/account-admin-guard';
import { getAccountAuth } from '@/lib/account-auth';
import { AccountInputError } from '@/lib/account-users';
import { deleteAccountSearchRecord } from '@/lib/account-admin-records';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
export async function DELETE(req: Request) {
  const denied = guardAccountAdminRequest(req); if (denied) return denied;
  try {
    const raw = await req.text();
    if (raw.length > 16384) throw new AccountInputError('请求过大', 413);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { throw new AccountInputError('请求格式无效'); }
    const { database } = await getAccountAuth();
    deleteAccountSearchRecord(database, input);
    return Response.json({ success: true }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof AccountInputError ? error.message : '删除搜索记录失败，请稍后重试' },
      { status: error instanceof AccountInputError ? error.status : 500, headers });
  }
}
