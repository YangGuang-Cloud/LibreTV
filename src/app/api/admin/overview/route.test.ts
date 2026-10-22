import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import { ADMIN_SESSION_COOKIE, signAdminSession } from '@/lib/admin-auth';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { getServerMetrics } from '@/lib/server-metrics';
import { getAccountAuth } from '@/lib/account-auth';
vi.mock('@/lib/server-metrics', () => ({ getServerMetrics: vi.fn() }));
vi.mock('@/lib/account-auth', () => ({ getAccountAuth: vi.fn() }));
const metrics = { traffic: null, sampledAt: 1000, cpuPercent: null, cpuCores: 2, loadAverage: [0,0,0], memory: { totalBytes: 1000, usedBytes: 500, appBytes: 100 }, disk: null, network: null, hostUptimeSeconds: 100, appUptimeSeconds: 10 };
function req(cookie?: string) { return new Request('https://tv.example.com/api/admin/overview', { headers: cookie ? { cookie } : {} }); }
beforeEach(() => { vi.stubEnv('ADMIN_PASSWORD', 'test-admin'); vi.stubEnv('PASSWORD', 'test-viewer'); vi.stubEnv('AUTH_MODE', 'password'); vi.mocked(getServerMetrics).mockResolvedValue(metrics); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('匿名和观看会话不能读取服务器监控信息', async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req(`${SESSION_COOKIE}=${signSession().token}`))).status).toBe(401);
  expect(getServerMetrics).not.toHaveBeenCalled();
});
it('未开启账号模式也可查看服务器状态，明确显示统计不可用并禁止缓存', async () => {
  const response = await GET(req(`${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({ server: metrics, accounts: null, accountNotice: '开启账号模式后显示用户统计' });
  expect(getAccountAuth).not.toHaveBeenCalled();
});
it('账号数据库故障不影响服务器指标，错误不暴露内部信息', async () => {
  vi.stubEnv('AUTH_MODE', 'account'); vi.stubEnv('BETTER_AUTH_URL', 'https://tv.example.com'); vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-with-at-least-32-characters');
  vi.mocked(getAccountAuth).mockRejectedValue(new Error('private database information'));
  const response = await GET(req(`${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`));
  const body = await response.json();
  expect(body).toMatchObject({ accounts: null, accountNotice: '账号统计暂不可用', server: metrics });
  expect(JSON.stringify(body)).not.toContain('private database');
});
it('无法获取服务器数据时返回可重试错误，不伪造零流量', async () => {
  vi.mocked(getServerMetrics).mockRejectedValueOnce(new Error('private path'));
  const response = await GET(req(`${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: '总览读取失败，请稍后重试' });
});
