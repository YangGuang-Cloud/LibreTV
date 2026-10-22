'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AdminOverview } from '@/lib/admin-overview-model';

const count = (value?: number) => value === undefined ? '—' : value.toLocaleString('zh-CN');
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(0)} MB`;
const trafficBytes = (value: number) => value >= 1024 ** 4 ? `${(value / 1024 ** 4).toFixed(2)} TB` : value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(2)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`;
const bandwidth = (value: number | null | undefined) => value == null ? '采样中' : value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} Mbps` : `${(value / 1000).toFixed(1)} Kbps`;
const duration = (value: number) => value >= 86400 ? `${Math.floor(value / 86400)} 天 ${Math.floor(value % 86400 / 3600)} 小时` : value >= 3600 ? `${Math.floor(value / 3600)} 小时 ${Math.floor(value % 3600 / 60)} 分钟` : value >= 60 ? `${Math.floor(value / 60)} 分钟` : `${Math.floor(value)} 秒`;
const percentage = (used: number, total: number) => total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : 0;
function Metric({ label, value, hint, accent = false }: { label: string; value: ReactNode; hint: string; accent?: boolean }) {
  return <div className="card p-5 space-y-2"><p className="text-sm text-muted">{label}</p><p className={`text-2xl sm:text-3xl font-semibold tabular-nums break-words ${accent ? 'text-accent' : ''}`}>{value}</p><p className="text-xs text-muted leading-relaxed">{hint}</p></div>;
}
function Resource({ label, value, percent, hint }: { label: string; value: string; percent: number | null; hint: string }) {
  return <div className="space-y-3 min-w-0"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm text-muted">{label}</h4><span className="font-semibold tabular-nums">{value}</span></div><div className="h-2 rounded-full bg-chip overflow-hidden" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${percent ?? 0}%` }} /></div><p className="text-xs text-muted break-words">{hint}</p></div>;
}
interface TrafficPoint { at: number; received: number | null; sent: number | null; }
function TrafficChart({ points }: { points: TrafficPoint[] }) {
  const valid = points.filter((point) => point.received !== null && point.sent !== null);
  if (valid.length < 2) return <div className="h-36 flex items-center justify-center text-sm text-muted text-center px-4">等待两次有效带宽采样</div>;
  const peak = Math.max(1, ...valid.flatMap((point) => [point.received!, point.sent!]));
  const begin = points[0].at, range = Math.max(1, points[points.length - 1].at - begin);
  const line = (key: 'received' | 'sent') => {
    let connected = false;
    return points.map((point) => {
      if (point[key] === null) { connected = false; return ''; }
      const command = connected ? 'L' : 'M'; connected = true;
      return `${command}${((point.at - begin) / range * 600).toFixed(1)},${(118 - point[key]! / peak * 108).toFixed(1)}`;
    }).join(' ');
  };
  return <div className="space-y-2"><p className="text-xs text-muted text-right">峰值 {bandwidth(peak)}</p><svg className="w-full h-36 overflow-visible" viewBox="0 0 600 128" preserveAspectRatio="none" role="img" aria-label="最近两分钟的服务器入站和出站带宽趋势">
    {[10, 64, 118].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="currentColor" className="text-muted" opacity="0.15" />)}
    <path d={line('received')} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" className="text-muted" />
    <path d={line('sent')} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" className="text-accent" />
  </svg><div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>最近两分钟 · 本页打开期间采样</span><span><span className="text-accent">━ 出站</span><span className="ml-4">┄ 入站</span></span></div></div>;
}

export function AdminOverviewPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [points, setPoints] = useState<TrafficPoint[]>([]);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let stopped = false; let busy = false; let request: AbortController | null = null;
    const load = async () => {
      if (stopped || busy || document.visibilityState === 'hidden') return;
      busy = true; setRefreshing(true);
      const controller = new AbortController(); request = controller;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch('/api/admin/overview', { cache: 'no-store', signal: controller.signal });
        if (stopped) return;
        if (response.status === 401) { onSessionExpired(); return; }
        const body = await response.json();
        if (stopped) return;
        if (!response.ok) throw new Error(body.error || '总览读取失败');
        const value = body as AdminOverview;
        setData(value); setError('');
        setPoints((previous) => [...previous.filter((point) => point.at > value.server.sampledAt - 120_000 && point.at !== value.server.sampledAt), { at: value.server.sampledAt, received: value.server.network?.receivedBitsPerSecond ?? null, sent: value.server.network?.sentBitsPerSecond ?? null }].slice(-30));
      } catch (cause) { if (!stopped) setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : '更新超时，请稍后重试'); }
      finally { clearTimeout(timeout); busy = false; if (!stopped) setRefreshing(false); }
    };
    refresh.current = () => { void load(); };
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; request?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [onSessionExpired]);
  const server = data?.server, accounts = data?.accounts;
  const networkValue = (bits: number | null | undefined) => !server ? '—' : !server.network ? '暂不可用' : bandwidth(bits);
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">运行总览</h2><p className="mt-1 text-xs text-muted">每 5 秒更新{server && ` · ${new Date(server.sampledAt).toLocaleTimeString('zh-CN', { hour12: false })}`}</p></div><button className="btn-ghost text-sm" disabled={refreshing} onClick={() => refresh.current()}>刷新</button></div>
    {error && <p role="alert" className="text-sm text-danger">{error}{data ? '，当前保留上次读取的数据。' : '。'}</p>}
    {data?.accountNotice && <p className="text-sm text-muted">{data.accountNotice}</p>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Metric label="当前在线" value={count(accounts?.online)} hint="按账号去重，包含正在观看" accent />
      <Metric label="正在观看" value={count(accounts?.watching)} hint="近期上报正在播放的账号" accent />
      <Metric label="今日活跃" value={count(accounts?.todayActive)} hint="北京时间今日有活动的账号" />
      <Metric label="账号总数" value={count(accounts?.total)} hint={accounts ? `${accounts.total - accounts.disabled} 个正常 · ${accounts.disabled} 个停用` : '等待账号统计'} />
      <Metric label="当前出站带宽" value={networkValue(server?.network?.sentBitsPerSecond)} hint="服务器向外发送数据的速率" accent />
      <Metric label="当前入站带宽" value={networkValue(server?.network?.receivedBitsPerSecond)} hint="服务器接收数据的速率" />
      <Metric label="今日观看时长" value={accounts ? duration(accounts.todayWatchSeconds) : '—'} hint="所有账号今日观看时间合计" />
      <Metric label="累计观看时长" value={accounts ? duration(accounts.totalWatchSeconds) : '—'} hint="从客户端接入统计后累计" />
    </div>
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">流量统计</h3>{server?.traffic && <span className="text-xs text-muted">从 {new Date(server.traffic.startedAt).toLocaleString('zh-CN', { hour12: false })} 开始统计</span>}</div>
      <div className="grid sm:grid-cols-3 gap-5">
        {([['today', '今日流量'], ['month', '本月流量'], ['total', '累计流量']] as const).map(([key, label]) => <div key={key} className="space-y-2 min-w-0"><h4 className="text-sm text-muted">{label}</h4><p className="font-semibold text-accent tabular-nums">出站 {server?.traffic ? trafficBytes(server.traffic[key].sentBytes) : '—'}</p><p className="text-sm tabular-nums">入站 {server?.traffic ? trafficBytes(server.traffic[key].receivedBytes) : '—'}</p></div>)}
      </div>
      <p className="text-xs text-muted leading-relaxed">{server?.traffic ? `按北京时间统计，自动保存，应用重启后继续累计。${server.traffic.interruptions ? `已遇到 ${server.traffic.interruptions} 次系统重启、网卡切换或计数重置，无法确认的间隔未计入。` : ''}` : server?.network ? '流量统计暂不可用，请稍后重试。' : '当前环境不支持流量统计。'}统计从启用后开始，系统重启前未采到的流量无法补算。</p>
    </div>
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="card p-5 space-y-4"><h3 className="font-medium">带宽趋势</h3>{server && !server.network ? <div className="h-36 flex items-center justify-center text-sm text-muted">当前环境不支持主网卡流量采样</div> : <TrafficChart points={points} />}<p className="text-xs text-muted leading-relaxed">来自服务器主网卡，包含视频代理、后台和其他服务流量。首次读取或长时间未采样时，等待下一次采样计算速率。</p></div>
      <div className="card p-5 space-y-5"><h3 className="font-medium">服务器资源</h3>
        <Resource label="CPU 使用率" value={server?.cpuPercent == null ? '采样中' : `${server.cpuPercent.toFixed(1)}%`} percent={server?.cpuPercent ?? null} hint={server ? `${server.cpuCores} 核 · 1 分钟平均负载 ${server.loadAverage[0].toFixed(2)}` : '等待服务器采样'} />
        <Resource label="内存使用" value={server ? `${percentage(server.memory.usedBytes, server.memory.totalBytes).toFixed(1)}%` : '—'} percent={server ? percentage(server.memory.usedBytes, server.memory.totalBytes) : null} hint={server ? `${bytes(server.memory.usedBytes)} / ${bytes(server.memory.totalBytes)} · 应用 ${bytes(server.memory.appBytes)}` : '等待服务器采样'} />
        <Resource label="数据盘使用" value={server?.disk ? `${percentage(server.disk.usedBytes, server.disk.totalBytes).toFixed(1)}%` : '暂不可用'} percent={server?.disk ? percentage(server.disk.usedBytes, server.disk.totalBytes) : null} hint={server?.disk ? `${bytes(server.disk.usedBytes)} / ${bytes(server.disk.totalBytes)} · 可用 ${bytes(server.disk.availableBytes)}` : '未能读取磁盘信息'} />
      </div>
    </div>
    {server && <div className="card p-5"><dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm"><div><dt className="text-muted">服务器运行</dt><dd className="mt-1">{duration(server.hostUptimeSeconds)}</dd></div><div><dt className="text-muted">应用运行</dt><dd className="mt-1">{duration(server.appUptimeSeconds)}</dd></div><div><dt className="text-muted">应用版本</dt><dd className="mt-1">{data.version}</dd></div><div><dt className="text-muted">构建版本</dt><dd className="mt-1">{data.buildId === 'local' ? '本地构建' : data.buildId.slice(0, 7)}</dd></div></dl></div>}
    <p className="text-xs text-muted">在线状态根据最近 75 秒的客户端心跳估算，未接入上报的旧客户端不会计入。有效登录会话不等同于在线人数。</p>
  </section>;
}
