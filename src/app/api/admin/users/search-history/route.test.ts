import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DELETE } from './route';
import { ADMIN_SESSION_COOKIE, signAdminSession } from '@/lib/admin-auth';
import { getAccountAuth } from '@/lib/account-auth';
import { deleteAccountSearchRecord } from '@/lib/account-admin-records';
import { AccountInputError } from '@/lib/account-users';

vi.mock('@/lib/account-auth', () => ({ getAccountAuth: vi.fn(async () => ({ database: {} })) }));
vi.mock('@/lib/account-admin-records', () => ({ deleteAccountSearchRecord: vi.fn() }));
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'account'); vi.stubEnv('ADMIN_PASSWORD', 'admin-fixture');
  vi.stubEnv('BETTER_AUTH_URL', 'https://local.test'); vi.stubEnv('BETTER_AUTH_SECRET', 'search-history-admin-test-secret-32-chars');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());
function request(body = '{"userId":"a","key":"目标","version":1}', headers: Record<string, string> = {}, admin = true) {
  return new Request('https://local.test/api/admin/users/search-history', { method: 'DELETE', body, headers: { 'Content-Type': 'application/json', Origin: 'https://local.test', ...(admin ? { cookie: `${ADMIN_SESSION_COOKIE}=${signAdminSession().token}` } : {}), ...headers } });
}
it('只有独立管理员能删除，并拒绝跨站请求及非 JSON', async () => {
  expect((await DELETE(request(undefined, {}, false))).status).toBe(401);
  expect((await DELETE(request(undefined, { Origin: 'https://other.test' }))).status).toBe(403);
  expect((await DELETE(request(undefined, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
  expect((await DELETE(request(undefined, { 'Content-Type': 'text/plain' }))).status).toBe(415);
  expect(getAccountAuth).not.toHaveBeenCalled();
});
it('管理员收到删除成功响应，不返回原内容，响应禁止缓存', async () => {
  vi.mocked(deleteAccountSearchRecord).mockImplementation(() => {});
  const response = await DELETE(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({ success: true });
  expect(deleteAccountSearchRecord).toHaveBeenCalledWith(expect.anything(), { userId: 'a', key: '目标', version: 1 });
});
it('格式错误和过大的请求不访问数据库，记录冲突和不存在保持对应状态', async () => {
  expect((await DELETE(request('{broken'))).status).toBe(400);
  expect((await DELETE(request(' '.repeat(16385)))).status).toBe(413);
  expect(getAccountAuth).not.toHaveBeenCalled();
  for (const status of [404, 409]) {
    vi.mocked(deleteAccountSearchRecord).mockImplementation(() => { throw new AccountInputError('记录已变化', status); });
    expect((await DELETE(request())).status).toBe(status);
  }
});
