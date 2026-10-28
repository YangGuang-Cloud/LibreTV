'use client';
import { useCallback, useEffect, useState } from 'react';
import { describeSessionDevice } from '@/lib/session-device';
import { ConfirmDialog } from './confirm-dialog';
interface Device { id: string; createdAt: number; lastLoginAt: number; lastSeenAt: number; userAgent: string | null; ipAddress: string | null; sessions: number; }
interface HistoryPage { total: number; items: Device[]; offset: number; limit: number; }
const date = (value: number) => new Date(value).toLocaleString('zh-CN', { hour12: false });
export function AdminDeviceManager({ userId, onSessionExpired }: { userId: string; onSessionExpired: () => void }) {
  const [data, setData] = useState<{ maximum: number; total: number; items: Device[] } | null>(null);
  const [maximum, setMaximum] = useState(3), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Device | null>(null);
  const [view, setView] = useState<'active' | 'history'>('active');
  const [history, setHistory] = useState<HistoryPage | null>(null), [offset, setOffset] = useState(0), [historyLoading, setHistoryLoading] = useState(false), [revision, setRevision] = useState(0);
  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/users/devices?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
    if (res.status === 401) { onSessionExpired(); return; }
    const body = await res.json(); if (!res.ok) throw new Error(body.error || '读取设备失败'); setData(body); setMaximum(body.maximum);
  }, [userId, onSessionExpired]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  useEffect(() => {
    if (view !== 'history') return;
    const controller = new AbortController(); setHistoryLoading(true); setError('');
    void (async () => {
      try {
        const response = await fetch(`/api/admin/users/devices?${new URLSearchParams({ userId, view: 'history', offset: String(offset) })}`, { cache: 'no-store', signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        const body = await response.json(); if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error || '读取历史设备失败');
        setHistory(body);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取历史设备失败'); }
      finally { if (!controller.signal.aborted) setHistoryLoading(false); }
    })();
    return () => controller.abort();
  }, [userId, view, offset, revision, onSessionExpired]);
  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/users/devices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, ...body }) });
      if (res.status === 401) { onSessionExpired(); return; }
      const value = await res.json(); if (!res.ok) throw new Error(value.error || '操作失败');
      setData(value); setMaximum(value.maximum); setSelected(null); setRevision(n => n + 1); setMessage(body.action === 'logout-device' ? '该设备已退出登录，名额已释放' : '设备上限已保存');
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); }
  };
  const currentHistory = history?.offset === offset ? history : null;
  const items = view === 'active' ? data?.items : currentHistory?.items;
  return <div className="card p-5 space-y-5">
    <div className="flex justify-between gap-3 items-center"><h3 className="font-medium">登录设备{data && `（${data.total} / ${data.maximum}）`}</h3><button className="btn-ghost text-sm" disabled={busy || historyLoading} onClick={() => { setRevision(n => n + 1); void load().catch(e => setError(e.message)); }}>刷新</button></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void mutate({ action: 'set-limit', maximum }); }}><label className="text-sm">最多同时登录设备数<input type="number" required min={1} max={50} value={maximum} onChange={e => setMaximum(Number(e.target.value))} className="input block mt-2 w-32" /></label><button className="btn-primary text-sm" disabled={busy}>保存上限</button></form>
    <p className="text-xs text-muted leading-relaxed">同一设备重复登录只占一个名额，退出账号或会话过期后自动释放。网页按浏览器、iOS 按安装实例计数。达到上限时，可在其他设备退出账号，或在此退出指定设备；用户数据保留。关闭页面或 App 不等于退出账号。</p>
    <div className="flex flex-wrap gap-2" aria-label="设备记录分类">
      <button className={view === 'active' ? 'btn-primary text-sm' : 'btn-ghost text-sm'} aria-pressed={view === 'active'} disabled={busy} onClick={() => setView('active')}>当前登录{data && `（${data.total}）`}</button>
      <button className={view === 'history' ? 'btn-primary text-sm' : 'btn-ghost text-sm'} aria-pressed={view === 'history'} disabled={busy} onClick={() => setView('history')}>历史设备{history && `（${history.total}）`}</button>
    </div>
    {view === 'history' && <p className="text-xs text-muted">按最近登录时间倒序，同一设备合并展示，包含当前已登录和曾经登录的设备。历史记录不占登录名额；这里不提供每次登录、退出的逐条事件明细。</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}{message && <p role="status" className="text-sm text-accent">{message}</p>}
    <div className="max-h-[55vh] overflow-y-auto divide-y divide-line" aria-label={view === 'active' ? '当前登录设备列表' : '历史设备列表'}>
      {items?.map(device => { const info = describeSessionDevice(device.userAgent); return <article key={device.id} className="py-4 space-y-2 text-sm"><div className="flex justify-between gap-4 items-start"><div className="min-w-0"><p className="font-medium break-words">{info.name}</p><p className="text-muted">{info.detail}</p></div>{view === 'active' ? <button className="btn-ghost text-danger text-sm" disabled={busy} onClick={() => setSelected(device)}>退出登录</button> : <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${device.sessions ? 'bg-accent/10 text-accent' : 'bg-chip text-muted'}`}>{device.sessions ? '已登录' : '未登录'}</span>}</div><p className="text-xs text-muted">设备编号：{device.id.slice(0, 8)} · {device.sessions} 个有效会话</p><p className="text-xs text-muted">首次登录：{date(device.createdAt)}</p><p className="text-xs text-muted">最近登录：{date(device.lastLoginAt)}</p><p className="text-xs text-muted">最近使用：{date(device.lastSeenAt)} · IP：{device.ipAddress || '未记录'}</p></article>; })}
      {view === 'history' && historyLoading && !currentHistory ? <p className="text-muted text-sm text-center py-5">正在读取历史设备…</p> : items?.length === 0 && <p className="text-muted text-sm text-center py-5">{view === 'active' ? '暂无已登录设备' : '暂无历史设备'}</p>}
    </div>
    {view === 'history' && currentHistory && currentHistory.total > currentHistory.limit && <div className="flex flex-wrap items-center gap-3 text-sm"><button className="btn-ghost" disabled={historyLoading || offset === 0} onClick={() => setOffset(Math.max(0, offset - currentHistory.limit))}>上一页</button><span>第 {Math.floor(offset / currentHistory.limit) + 1} 页 · 共 {currentHistory.total} 台</span><button className="btn-ghost" disabled={historyLoading || offset + currentHistory.limit >= currentHistory.total} onClick={() => setOffset(offset + currentHistory.limit)}>下一页</button></div>}
    {selected && <ConfirmDialog open danger title="退出设备登录" message={`确认让 ${describeSessionDevice(selected.userAgent).name} 退出登录？该设备会释放一个名额，账号数据保留。`} onConfirm={() => { if (!busy) void mutate({ action: 'logout-device', deviceId: selected.id }); }} onCancel={() => { if (!busy) setSelected(null); }} />}
  </div>;
}
