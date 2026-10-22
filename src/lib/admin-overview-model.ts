export interface TrafficTotals {
  startedAt: number; sampledAt: number; interruptions: number;
  today: { receivedBytes: number; sentBytes: number };
  month: { receivedBytes: number; sentBytes: number };
  total: { receivedBytes: number; sentBytes: number };
}
export interface OverviewAccounts {
  total: number; disabled: number; online: number; watching: number; todayActive: number;
  todayWatchSeconds: number; totalWatchSeconds: number;
}
export interface ServerMetrics {
  sampledAt: number;
  traffic: TrafficTotals | null;
  cpuPercent: number | null; cpuCores: number; loadAverage: number[];
  memory: { totalBytes: number; usedBytes: number; appBytes: number };
  disk: { totalBytes: number; usedBytes: number; availableBytes: number } | null;
  network: { interface: string; receivedBitsPerSecond: number | null; sentBitsPerSecond: number | null; intervalMs: number | null } | null;
  hostUptimeSeconds: number; appUptimeSeconds: number;
}
export interface AdminOverview {
  accounts: OverviewAccounts | null; accountNotice: string | null;
  server: ServerMetrics; version: string; buildId: string;
}
