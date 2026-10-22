import os from 'node:os';
import fs from 'node:fs/promises';
import { recordServerTraffic } from './server-traffic';
import type { ServerMetrics } from './admin-overview-model';

interface NetworkCounters { interface: string; received: number; sent: number; }
export interface MetricsSnapshot extends Omit<ServerMetrics, 'cpuPercent' | 'network' | 'traffic'> {
  cpu: { total: number; idle: number };
  counters: NetworkCounters | null;
}

export function parsePrimaryNetwork(dev: string, routes: string): NetworkCounters | null {
  const interfaces = new Map<string, NetworkCounters>();
  for (const line of dev.split('\n')) {
    const split = line.indexOf(':'); if (split < 0) continue;
    const name = line.slice(0, split).trim();
    if (/^(lo$|veth|docker|br-|virbr|tun|tap|wg|tailscale|sit|ip6tnl)/.test(name)) continue;
    const fields = line.slice(split + 1).trim().split(/\s+/);
    const received = Number(fields[0]), sent = Number(fields[8]);
    if (Number.isSafeInteger(received) && received >= 0 && Number.isSafeInteger(sent) && sent >= 0) interfaces.set(name, { interface: name, received, sent });
  }
  const defaults = routes.split('\n').map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === '00000000' && (parseInt(parts[3], 16) & 1) !== 0 && interfaces.has(parts[0]))
    .sort((a, b) => Number(a[6]) - Number(b[6]));
  return defaults.length ? interfaces.get(defaults[0][0])! : interfaces.values().next().value ?? null;
}
export function memoryUsage(total: number, free: number, meminfo: string) {
  const availableKb = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
  const available = availableKb ? Number(availableKb) * 1024 : free;
  return { totalBytes: total, usedBytes: Math.max(0, Math.min(total, total - available)), appBytes: process.memoryUsage().rss };
}
export async function readMetricsSnapshot(): Promise<MetricsSnapshot> {
  const [meminfo, dev, routes, disk] = await Promise.allSettled([
    fs.readFile('/proc/meminfo', 'utf8'), fs.readFile('/proc/net/dev', 'utf8'), fs.readFile('/proc/net/route', 'utf8'),
    fs.statfs(process.env.SERVER_DATA_DIR || process.cwd()),
  ]);
  const cpus = os.cpus();
  const cpu = cpus.reduce((sum, item) => ({ total: sum.total + Object.values(item.times).reduce((a, b) => a + b, 0), idle: sum.idle + item.times.idle }), { total: 0, idle: 0 });
  return {
    sampledAt: Date.now(), cpu, cpuCores: cpus.length, loadAverage: os.loadavg(),
    memory: memoryUsage(os.totalmem(), os.freemem(), meminfo.status === 'fulfilled' ? meminfo.value : ''),
    disk: disk.status === 'fulfilled' ? { totalBytes: disk.value.bsize * disk.value.blocks, usedBytes: disk.value.bsize * (disk.value.blocks - disk.value.bfree), availableBytes: disk.value.bsize * disk.value.bavail } : null,
    counters: dev.status === 'fulfilled' ? parsePrimaryNetwork(dev.value, routes.status === 'fulfilled' ? routes.value : '') : null,
    hostUptimeSeconds: os.uptime(), appUptimeSeconds: process.uptime(),
  };
}
export function compareMetrics(current: MetricsSnapshot, previous?: MetricsSnapshot): ServerMetrics {
  const { cpu, counters, ...base } = current;
  const elapsed = previous ? current.sampledAt - previous.sampledAt : 0;
  const total = previous ? cpu.total - previous.cpu.total : 0;
  const idle = previous ? cpu.idle - previous.cpu.idle : 0;
  const sameInterface = previous?.counters?.interface === counters?.interface;
  const validCounters = elapsed >= 1000 && elapsed <= 30_000 && sameInterface && !!previous?.counters && !!counters
    && counters.received >= previous.counters.received && counters.sent >= previous.counters.sent;
  return { ...base, traffic: null, cpuPercent: elapsed >= 1000 && elapsed <= 30_000 && total > 0 && idle >= 0 ? Math.max(0, Math.min(100, (total - idle) / total * 100)) : null,
    network: counters ? { interface: counters.interface,
      receivedBitsPerSecond: validCounters ? (counters.received - previous!.counters!.received) * 8000 / elapsed : null,
      sentBitsPerSecond: validCounters ? (counters.sent - previous!.counters!.sent) * 8000 / elapsed : null,
      intervalMs: validCounters ? elapsed : null } : null };
}
// Shared sampling baseline across administrators; requests within a second reuse one result.
const metricsGlobal = globalThis as typeof globalThis & { lunaMetrics?: { snapshot: MetricsSnapshot; result: ServerMetrics }; lunaMetricsPending?: Promise<ServerMetrics> };
export async function getServerMetrics(): Promise<ServerMetrics> {
  if (metricsGlobal.lunaMetrics && Date.now() - metricsGlobal.lunaMetrics.snapshot.sampledAt < 1000) return metricsGlobal.lunaMetrics.result;
  if (metricsGlobal.lunaMetricsPending) return metricsGlobal.lunaMetricsPending;
  metricsGlobal.lunaMetricsPending = readMetricsSnapshot().then(async (snapshot) => {
    const result = compareMetrics(snapshot, metricsGlobal.lunaMetrics?.snapshot);
    if (snapshot.counters) {
      try {
        const bootId = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
        result.traffic = recordServerTraffic({ at: snapshot.sampledAt, bootId, ...snapshot.counters });
      } catch { /* Storage failures leave real-time metrics available; totals stay explicitly unavailable. */ }
    }
    metricsGlobal.lunaMetrics = { snapshot, result }; return result;
  }).finally(() => { metricsGlobal.lunaMetricsPending = undefined; });
  return metricsGlobal.lunaMetricsPending;
}

const collectorGlobal = globalThis as typeof globalThis & { lunaMetricsTimer?: ReturnType<typeof setInterval> };
export function startServerMetricsCollector() {
  if (collectorGlobal.lunaMetricsTimer) return;
  const collect = () => { void getServerMetrics().catch(() => { /* Retry at the next interval. */ }); };
  collect();
  collectorGlobal.lunaMetricsTimer = setInterval(collect, 15_000);
  collectorGlobal.lunaMetricsTimer.unref();
}
