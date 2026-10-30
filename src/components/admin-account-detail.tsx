'use client';

import { AdminDeviceManager } from './admin-device-manager';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AdminAccountDetail, AdminAccountRecord, AdminAccountSection } from '@/lib/account-admin-model';
import { describeSessionDevice } from '@/lib/session-device';

const sections: { key: AdminAccountSection; label: string }[] = [
  { key: 'history', label: '观看历史' }, { key: 'search', label: '搜索历史' },
  { key: 'progress', label: '分集进度' }, { key: 'preference', label: '账号设置' },
  { key: 'favorite', label: '直播收藏' }, { key: 'recent', label: '直播历史' }, { key: 'sessions', label: '登录设备' },
];
const preferenceNames: Record<string, string> = {
  yellowFilter: '成人内容过滤', adFilter: '广告切片过滤', autoplayNext: '自动连播',
  doubanEnabled: '首页推荐', recommendSource: '推荐来源', recommendSourceTouched: '已自选推荐来源',
  imageProxyMode: '封面加载方式', imageProxyModeTouched: '已自选封面加载方式', customImageProxy: '自定义图片代理',
  customAPIs: '自定义点播源', selectedKeys: '已选点播源', envKeysSeen: '已接收点播源', subscriptions: '点播订阅',
  liveEnvKeysSeen: '已接收直播源', liveSubscriptions: '直播订阅', liveSelectedUrls: '已选直播源', envSubsSeen: '已接收订阅',
};
export function accountDate(value: unknown) {
  const number = typeof value === 'number' ? value : NaN;
  const date = new Date(number);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '—';
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, fallback = '—') => typeof value === 'string' && value ? value : fallback;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const time = (value: unknown) => { const seconds = Math.max(0, Math.floor(number(value))); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const watchDuration = (seconds: number) => seconds >= 3600 ? `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分钟` : seconds >= 60 ? `${Math.floor(seconds / 60)} 分钟` : `${seconds} 秒`;
const episode = (value: unknown) => `第 ${number(value) + 1} 集`;

function RecordContent({ row, section }: { row: AdminAccountRecord; section: AdminAccountSection }) {
  const value = object(row.value);
  if (section === 'history') return <>
    <p className="font-medium break-words">{text(value.title, row.key)}</p>
    <p className="text-sm text-muted">{episode(value.episodeIndex)}{number(value.totalEpisodes) > 0 && ` / 共 ${number(value.totalEpisodes)} 集`} · {time(value.playbackPosition)} / {time(value.duration)}</p>
    <p className="text-xs text-muted">最近观看：{accountDate(value.timestamp)}</p>
    <p className="text-xs text-muted break-all">来源：{text(value.sourceKey)} · 影片编号：{text(value.vodId)}</p>
  </>;
  if (section === 'search') return <>
    <p className="font-medium break-words">{text(value.text, row.key)}</p>
    <p className="text-xs text-muted">最近搜索：{accountDate(value.timestamp)}</p>
  </>;
  if (section === 'progress') return <>
    <p className="font-medium break-words">{row.title || row.key}</p>
    <p className="text-sm text-muted">{episode(Number(row.key.slice(row.key.lastIndexOf('_') + 1)))} · {time(value.position)} / {time(value.duration)}</p>
    <p className="text-xs text-muted">进度时间：{accountDate(value.updatedAt)}</p>
  </>;
  if (section === 'preference') {
    const display = typeof row.value === 'boolean' ? row.value ? '开启' : '关闭'
      : typeof row.value === 'string' ? ({ direct: '直接加载', proxy: '服务器代理', custom: '自定义代理' }[row.value] || row.value || '未设置')
        : row.value === null ? '无保留内容' : JSON.stringify(row.value, null, 2);
    return <><p className="font-medium">{preferenceNames[row.key] || row.key}</p><pre className="text-sm text-muted whitespace-pre-wrap break-all font-sans max-h-52 overflow-y-auto">{display}</pre></>;
  }
  return <>
    <p className="font-medium break-words">{text(value.name, row.title || row.key)}</p>
    {section === 'recent' && <p className="text-xs text-muted">最近观看：{accountDate(value.timestamp)}</p>}
    {typeof value.group === 'string' && <p className="text-sm text-muted">分组：{value.group}</p>}
    <p className="text-xs text-muted break-all">{text(value.url, row.key)}</p>
  </>;
}

export function AdminAccountDetailView({ userId, revision, onSessionExpired, actions }: {
  userId: string; revision: number; onSessionExpired: () => void; actions: ReactNode;
}) {
  const [section, setSection] = useState<AdminAccountSection>('history');
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [deleteError, setDeleteError] = useState('');
  const [pendingDeletes, setPendingDeletes] = useState<Map<string, AdminAccountRecord>>(new Map());
  const deleting = useRef(new Map<string, AdminAccountRecord>());
  const mutationGeneration = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const generation = mutationGeneration.current;
    setLoading(true); setError('');
    void (async () => {
      try {
        const query = new URLSearchParams({ userId, section, offset: String(offset) });
        const response = await fetch(`/api/admin/users/detail?${query}`, { cache: 'no-store', signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error || '账号详情读取失败');
        if (generation !== mutationGeneration.current || deleting.current.size) return;
        setDetail(body);
        if (offset > 0 && offset >= body.total) setOffset(Math.max(0, Math.ceil(body.total / body.limit) - 1) * body.limit);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '账号详情读取失败'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [userId, section, offset, revision, reload, onSessionExpired]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setReload((value) => value + 1); }, 20_000);
    return () => clearInterval(timer);
  }, []);
  async function removeSearchRecord(row: AdminAccountRecord) {
    if (deleting.current.has(row.key)) return;
    deleting.current.set(row.key, row); mutationGeneration.current += 1;
    setPendingDeletes(new Map(deleting.current)); setDeleteError('');
    try {
      const response = await fetch('/api/admin/users/search-history', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, key: row.key, version: row.version }) });
      if (response.status === 401) onSessionExpired();
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '删除失败，请重试');
      setDetail((value) => {
        if (!value || value.user.id !== userId) return value;
        const isSearch = value.section === 'search';
        return { ...value,
          counts: { ...value.counts, search: { total: Math.max(0, value.counts.search.total - 1), deleted: Math.max(0, value.counts.search.deleted - (row.deleted ? 1 : 0)) } },
          ...(isSearch ? { records: value.records.filter((item) => item.key !== row.key || item.version > row.version), total: Math.max(0, value.total - 1) } : {}),
        };
      });
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : '删除失败，请重试'); }
    finally {
      deleting.current.delete(row.key); mutationGeneration.current += 1;
      setPendingDeletes(new Map(deleting.current));
      if (!deleting.current.size) setReload((value) => value + 1);
    }
  }
  const current = detail?.section === section && detail.offset === offset ? detail : null;
  const pendingVisible = current?.section === 'search' ? current.records.filter((row) => (pendingDeletes.get(row.key)?.version ?? -1) >= row.version) : [];
  const visibleRecords = current?.records.filter((row) => section !== 'search' || (pendingDeletes.get(row.key)?.version ?? -1) < row.version) ?? [];
  const visibleTotal = current ? Math.max(0, current.total - pendingVisible.length) : 0;
  return <div className="flex flex-col gap-5">
    {detail && <div className="card p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h3 className="text-xl font-semibold break-all">{detail.user.name}</h3><p className="text-sm text-muted break-all mt-1">{detail.user.username}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs ${detail.user.banned ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>{detail.user.banned ? '已停用' : '正常'}</span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div><dt className="text-muted">创建时间</dt><dd className="mt-1">{accountDate(detail.user.createdAt)}</dd></div>
        <div><dt className="text-muted">账号更新时间</dt><dd className="mt-1">{accountDate(detail.user.updatedAt)}</dd></div>
        <div><dt className="text-muted">账号授权</dt><dd className="mt-1">{detail.authorization.state === 'active' ? '使用中' : detail.authorization.state === 'expired' ? '已到期' : '待激活'}</dd></div>
        <div><dt className="text-muted">授权到期</dt><dd className="mt-1">{detail.authorization.state === 'active' && detail.authorization.expiresAt === null ? '无限期' : accountDate(detail.authorization.expiresAt)}</dd></div>
        <div><dt className="text-muted">最后登录时间</dt><dd className="mt-1">{detail.lastLoginAt === null ? '暂无记录' : accountDate(detail.lastLoginAt)}</dd></div>
        <div><dt className="text-muted">有效登录会话</dt><dd className="mt-1">{detail.activeSessions}</dd></div>
      </dl>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg bg-chip p-4 text-sm">
        <div><p className="text-muted">当前状态</p><p className={`mt-1 font-medium ${detail.activity.status === 'watching' || detail.activity.status === 'online' ? 'text-accent' : ''}`}>{{ watching: '正在观看', online: '在线', offline: '离线', unknown: '暂无状态' }[detail.activity.status]}</p></div>
        <div><p className="text-muted">最后活跃</p><p className="mt-1">{accountDate(detail.activity.lastActiveAt)}</p></div>
        <div><p className="text-muted">今日观看</p><p className="mt-1 font-medium">{watchDuration(detail.activity.todaySeconds)}</p></div>
        <div><p className="text-muted">累计观看</p><p className="mt-1 font-medium">{watchDuration(detail.activity.totalSeconds)}</p></div>
      </div>
      <p className="text-xs text-muted">状态根据近期上报判断，可能有短暂延迟。时长按实际播放时间估算，倍速按经过的时间计算，同账号同时观看不重复累计；今日按北京时间统计。{detail.activity.trackingSince ? `统计开始于 ${accountDate(detail.activity.trackingSince)}。` : '尚未收到新版客户端的活动上报，无法补算以往时长。'}</p>
      <details className="text-xs text-muted"><summary className="cursor-pointer">账号编号</summary><p className="mt-2 break-all">{detail.user.id}</p></details>
      {actions}
    </div>}
    <AdminDeviceManager key={userId} userId={userId} onSessionExpired={onSessionExpired} />
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3"><h3 className="font-medium">账号数据</h3><button className="btn-ghost text-sm" disabled={loading} onClick={() => setReload((value) => value + 1)}>刷新</button></div>
      <div className="flex gap-2 overflow-x-auto pb-2" aria-label="账号数据分类">
        {sections.map((item) => <button key={item.key} aria-pressed={section === item.key} className={`${section === item.key ? 'btn-primary' : 'btn-ghost'} whitespace-nowrap text-sm`} onClick={() => { setSection(item.key); setOffset(0); }}>
          {item.label}{detail && ` ${item.key === 'sessions' ? detail.activeSessions : detail.counts[item.key].total - (item.key === 'search' ? pendingVisible.length : 0)}`}
        </button>)}
      </div>
      {section !== 'sessions' && <p className="text-xs text-muted">包含客户端已删除或超出显示上限的保留记录；同一条记录显示最后保存的内容。</p>}
      {section === 'sessions' && <p className="text-xs text-muted">仅展示尚未过期的登录会话，不代表设备当前在线。已退出或撤销的会话不会保留在此列表。</p>}
      {deleteError && <p role="alert" className="text-sm text-danger">{deleteError}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}<button className="btn-ghost ml-2" onClick={() => setReload((value) => value + 1)}>重试</button></p>}
      {loading && !current ? <p className="text-sm text-muted py-8 text-center" role="status">正在读取账号数据…</p> : current && <>
        {visibleTotal === 0 ? <p className="text-sm text-muted py-8 text-center">暂无{sections.find((item) => item.key === section)?.label}</p> : <div key={`${section}-${offset}`} className="admin-scrollbar max-h-[55vh] overflow-y-auto overscroll-contain divide-y divide-line pr-2" aria-label={sections.find((item) => item.key === section)?.label} tabIndex={0}>
          {visibleRecords.map((row) => <AccountRecordRow key={`${userId}-${section}-${row.key}`} row={row} section={section} onDelete={() => void removeSearchRecord(row)} />)}
          {current.sessions.map((session, index) => {
            const device = describeSessionDevice(session.userAgent);
            return <article key={`${offset}-${index}`} className="py-4 space-y-2 text-sm">
            <p className="font-medium break-words">{device.name}</p>
            <p className="text-muted">{device.detail}</p>
            {!device.exactModel && <p className="text-xs text-muted">具体型号未提供</p>}
            {session.userAgent && <details className="text-xs text-muted"><summary className="cursor-pointer">原始设备信息</summary><p className="mt-2 break-all">{session.userAgent}</p></details>}
            <p className="text-muted">IP：{session.ipAddress || '未记录'}</p>
            <p className="text-xs text-muted">登录：{accountDate(session.createdAt)}</p>
            <p className="text-xs text-muted">会话更新：{accountDate(session.updatedAt)} · 到期：{accountDate(session.expiresAt)}</p>
          </article>; })}
        </div>}
        {visibleTotal > current.limit && <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted">共 {visibleTotal} 条 · 第 {Math.floor(offset / current.limit) + 1} / {Math.ceil(visibleTotal / current.limit)} 页</span>
          <div className="flex gap-2"><button className="btn-ghost" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - current.limit))}>上一页</button><button className="btn-ghost" disabled={loading || offset + current.limit >= visibleTotal} onClick={() => setOffset(offset + current.limit)}>下一页</button></div>
        </div>}
      </>}
    </div>
  </div>;
}

function AccountRecordRow({ row, section, onDelete }: {
  row: AdminAccountRecord; section: AdminAccountSection; onDelete: () => void;
}) {
  return <article className="py-4 flex items-center gap-4">
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2"><span className={`rounded px-2 py-0.5 text-xs ${row.deleted ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>{row.deleted ? '客户端已隐藏' : '当前保留'}</span>{row.deletedAt !== null && <span className="text-xs text-muted">隐藏时间：{accountDate(row.deletedAt)}</span>}</div>
      <RecordContent row={row} section={section} />
      {row.value === null && <p className="text-xs text-muted">此记录没有保留下来的原始内容。</p>}
      <p className="text-xs text-muted">服务器更新时间：{accountDate(row.updatedAt)}</p>
    </div>
    {section === 'search' && <button className="btn-ghost text-sm shrink-0 text-danger" aria-label={`删除搜索记录 ${text(object(row.value).text, row.key)}`} onClick={onDelete}>删除</button>}
  </article>;
}
