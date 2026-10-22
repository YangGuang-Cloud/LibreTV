import { expect, it } from 'vitest';
import { compareMetrics, parsePrimaryNetwork, memoryUsage, type MetricsSnapshot } from './server-metrics';
const snapshot = (at: number, received: number, sent: number): MetricsSnapshot => ({ sampledAt: at, cpu: { total: at * 2, idle: at }, cpuCores: 2, loadAverage: [0.1, 0.2, 0.3], memory: { totalBytes: 1000, usedBytes: 400, appBytes: 100 }, disk: null, counters: { interface: 'eth0', received, sent }, hostUptimeSeconds: 100, appUptimeSeconds: 10 });
it('首个样本不伪造速率，两个样本正确换算网络位速率及 CPU 使用率', () => {
  const first = snapshot(1000, 100000, 200000);
  expect(compareMetrics(first)).toMatchObject({ cpuPercent: null, network: { receivedBitsPerSecond: null, sentBitsPerSecond: null } });
  expect(compareMetrics(snapshot(6000, 725000, 1450000), first)).toMatchObject({ cpuPercent: 50, network: { receivedBitsPerSecond: 1000000, sentBitsPerSecond: 2000000, intervalMs: 5000 } });
});
it('网卡切换、计数重置和长时间空窗重新采样，不显示负数或陈旧的平均速率', () => {
  const first = snapshot(1000, 100000, 200000);
  expect(compareMetrics(snapshot(6000, 1, 2), first).network?.sentBitsPerSecond).toBeNull();
  const changed = snapshot(6000, 200000, 300000); changed.counters!.interface = 'ens3';
  expect(compareMetrics(changed, first).network?.sentBitsPerSecond).toBeNull();
  expect(compareMetrics(snapshot(60000, 200000, 300000), first)).toMatchObject({ cpuPercent: null, network: { sentBitsPerSecond: null } });
  const missing = snapshot(6000, 200000, 300000); missing.counters = null;
  expect(compareMetrics(missing, first).network).toBeNull();
});
it('优先选择默认路由主网卡，不累计回环、虚拟和隧道网卡流量', () => {
  const dev = `Inter-| Receive | Transmit
  lo: 999999 0 0 0 0 0 0 0 999999 0
  eth0: 100 0 0 0 0 0 0 0 200 0
  ens3: 300 0 0 0 0 0 0 0 400 0
  docker0: 999999 0 0 0 0 0 0 0 999999 0
  tun0: 999999 0 0 0 0 0 0 0 999999 0`;
  const routes = `Iface Destination Gateway Flags RefCnt Use Metric
eth0 00000000 01000000 0003 0 0 200
ens3 00000000 01000000 0003 0 0 100`;
  expect(parsePrimaryNetwork(dev, routes)).toEqual({ interface: 'ens3', received: 300, sent: 400 });
  expect(parsePrimaryNetwork('', routes)).toBeNull();
  expect(parsePrimaryNetwork('lo: 100 0 0 0 0 0 0 0 100', '')).toBeNull();
});
it('Linux 内存以 MemAvailable 计算，避免把可回收缓存算作实际占满', () => {
  expect(memoryUsage(1000000, 1000, 'MemAvailable: 500 kB\n').usedBytes).toBe(488000);
  expect(memoryUsage(1000000, 1000, '').usedBytes).toBe(999000);
});
