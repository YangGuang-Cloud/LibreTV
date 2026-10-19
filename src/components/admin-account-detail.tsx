'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { AdminAccountDetail, AdminAccountRecord, AdminAccountSection } from '@/lib/account-admin-model';

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
  useEffect(() => {
    const controller = new AbortController();
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
        setDetail(body);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '账号详情读取失败'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [userId, section, offset, revision, reload, onSessionExpired]);
  const current = detail?.section === section && detail.offset === offset ? detail : null;
  return <div className="flex flex-col gap-5">
    {detail && <div className="card p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h3 className="text-xl font-semibold break-all">{detail.user.name}</h3><p className="text-sm text-muted break-all mt-1">{detail.user.username}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs ${detail.user.banned ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>{detail.user.banned ? '已停用' : '正常'}</span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div><dt className="text-muted">创建时间</dt><dd className="mt-1">{accountDate(detail.user.createdAt)}</dd></div>
        <div><dt className="text-muted">账号更新时间</dt><dd className="mt-1">{accountDate(detail.user.updatedAt)}</dd></div>
        <div><dt className="text-muted">最近数据变更</dt><dd className="mt-1">{accountDate(detail.lastDataAt)}</dd></div>
        <div><dt className="text-muted">有效登录会话</dt><dd className="mt-1">{detail.activeSessions}</dd></div>
      </dl>
      <details className="text-xs text-muted"><summary className="cursor-pointer">账号编号</summary><p className="mt-2 break-all">{detail.user.id}</p></details>
      {actions}
    </div>}
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3"><h3 className="font-medium">账号数据</h3><button className="btn-ghost text-sm" disabled={loading} onClick={() => setReload((value) => value + 1)}>刷新</button></div>
      <div className="flex gap-2 overflow-x-auto pb-2" aria-label="账号数据分类">
        {sections.map((item) => <button key={item.key} aria-pressed={section === item.key} className={`${section === item.key ? 'btn-primary' : 'btn-ghost'} whitespace-nowrap text-sm`} onClick={() => { setSection(item.key); setOffset(0); }}>
          {item.label}{detail && ` ${item.key === 'sessions' ? detail.activeSessions : detail.counts[item.key].total}`}
        </button>)}
      </div>
      {section !== 'sessions' && <p className="text-xs text-muted">包含客户端已删除或超出显示上限的保留记录；同一条记录显示最后保存的内容。</p>}
      {section === 'sessions' && <p className="text-xs text-muted">仅展示尚未过期的登录会话，不代表设备当前在线。已退出或撤销的会话不会保留在此列表。</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}<button className="btn-ghost ml-2" onClick={() => setReload((value) => value + 1)}>重试</button></p>}
      {loading && !current ? <p className="text-sm text-muted py-8 text-center" role="status">正在读取账号数据…</p> : current && <>
        {current.total === 0 ? <p className="text-sm text-muted py-8 text-center">暂无{sections.find((item) => item.key === section)?.label}</p> : <div key={`${section}-${offset}`} className="max-h-[55vh] overflow-y-auto overscroll-contain divide-y divide-line pr-1" aria-label={sections.find((item) => item.key === section)?.label} tabIndex={0}>
          {current.records.map((row) => <article key={row.key} className="py-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2"><span className={`rounded px-2 py-0.5 text-xs ${row.deleted ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>{row.deleted ? '客户端已隐藏' : '当前保留'}</span>{row.deletedAt !== null && <span className="text-xs text-muted">隐藏时间：{accountDate(row.deletedAt)}</span>}</div>
            <RecordContent row={row} section={section} />
            {row.value === null && <p className="text-xs text-muted">此记录没有保留下来的原始内容。</p>}
            <p className="text-xs text-muted">服务器更新时间：{accountDate(row.updatedAt)}</p>
          </article>)}
          {current.sessions.map((session, index) => <article key={`${offset}-${index}`} className="py-4 space-y-2 text-sm">
            <p className="font-medium break-words">{session.userAgent || '设备信息未提供'}</p>
            <p className="text-muted">IP：{session.ipAddress || '未记录'}</p>
            <p className="text-xs text-muted">登录：{accountDate(session.createdAt)}</p>
            <p className="text-xs text-muted">会话更新：{accountDate(session.updatedAt)} · 到期：{accountDate(session.expiresAt)}</p>
          </article>)}
        </div>}
        {current.total > current.limit && <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted">共 {current.total} 条 · 第 {Math.floor(offset / current.limit) + 1} / {Math.ceil(current.total / current.limit)} 页</span>
          <div className="flex gap-2"><button className="btn-ghost" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - current.limit))}>上一页</button><button className="btn-ghost" disabled={loading || offset + current.limit >= current.total} onClick={() => setOffset(offset + current.limit)}>下一页</button></div>
        </div>}
      </>}
    </div>
  </div>;
}
