import { guardAccountAdminRequest } from '@/lib/account-admin-guard';
import { getAccountAuth } from '@/lib/account-auth';
import { DeviceError, readDevices, readDeviceHistory, manageDevice } from '@/lib/account-devices';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
async function handle(req: Request) {
  const denied = guardAccountAdminRequest(req); if (denied) return denied;
  try {
    const { database } = await getAccountAuth();
    let userId: unknown;
    if (req.method === 'PATCH') {
      const raw = await req.text(); if (raw.length > 4096) throw new DeviceError('请求过大', 413);
      let body; try { body = JSON.parse(raw); } catch { throw new DeviceError('请求格式错误', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeviceError('请求格式错误', 400);
      userId = body.userId; manageDevice(database, userId, body);
    } else userId = new URL(req.url).searchParams.get('userId');
    if (typeof userId !== 'string' || !database.prepare('SELECT id FROM user WHERE id=?').get(userId)) throw new DeviceError('账号不存在', 404);
    if (req.method === 'GET') {
      const query = new URL(req.url).searchParams;
      const view = query.get('view') || 'active';
      if (!['active', 'history'].includes(view)) throw new DeviceError('设备分类无效', 400);
      if (view === 'history') {
        const offset = Number(query.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new DeviceError('分页参数无效', 400);
        return Response.json(readDeviceHistory(database, userId, offset), { headers });
      }
    }
    return Response.json(readDevices(database, userId), { headers });
  } catch (e) { return Response.json({ error: e instanceof DeviceError ? e.message : '设备管理操作失败' }, { status: e instanceof DeviceError ? e.status : 500, headers }); }
}
export const GET = handle; export const PATCH = handle;
