import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getServerMetrics, startServerMetricsCollector } from './server-metrics';
import type { ServerMetrics } from './admin-overview-model';
import type { MetricsSnapshot } from './server-metrics';
import type Database from 'better-sqlite3';
let received = 1000, sent = 2000;
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return { ...actual, default: { ...actual, uptime: () => 100 } };
});
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { default: { ...actual, readFile: vi.fn(async (filename: string) => {
    if (filename === '/proc/net/dev') return `eth0: ${received} 0 0 0 0 0 0 0 ${sent} 0`;
    if (filename === '/proc/net/route') return 'eth0 00000000 01000000 0003 0 0 100';
    if (filename === '/proc/meminfo') return 'MemAvailable: 500000 kB\n';
    if (filename === '/proc/sys/kernel/random/boot_id') return 'preview-boot';
    throw new Error('unexpected file');
  }) } };
});
const state = globalThis as typeof globalThis & {
  lunaMetricsTimer?: ReturnType<typeof setInterval>;
  lunaMetrics?: { snapshot: MetricsSnapshot; result: ServerMetrics };
  lunaMetricsPending?: Promise<ServerMetrics>;
  lunaTrafficDatabase?: { filename: string; database: Database.Database };
};
let directory: string;
afterEach(() => {
  if (state.lunaMetricsTimer) clearInterval(state.lunaMetricsTimer);
  delete state.lunaMetricsTimer; delete state.lunaMetrics; delete state.lunaMetricsPending;
  state.lunaTrafficDatabase?.database.close(); delete state.lunaTrafficDatabase;
  vi.useRealTimers(); vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true });
});
it('启动采集后无需后台页面请求也会持续入库，重复启动只创建一个定时器', async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'luna-collector-'));
  vi.stubEnv('SERVER_DATA_DIR', directory);
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T04:00:00Z'));
  startServerMetricsCollector(); startServerMetricsCollector();
  const first = await getServerMetrics();
  expect(first.traffic?.total).toEqual({ receivedBytes: 0, sentBytes: 0 });
  expect(vi.getTimerCount()).toBe(1);
  received += 500; sent += 1200;
  await vi.advanceTimersByTimeAsync(15_000);
  if (state.lunaMetricsPending) await state.lunaMetricsPending;
  // Inspect storage directly: no page or overview request triggered the second sample.
  const row = state.lunaTrafficDatabase!.database.prepare('SELECT received,sent FROM server_traffic_day').get();
  expect(row).toEqual({ received: 500, sent: 1200 });
});
