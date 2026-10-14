'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SourceConfig } from '@/lib/types';

interface Snapshot { sources: SourceConfig[]; revision: string }

export function AdminSourceManager({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<SourceConfig[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirty = saved !== null && JSON.stringify(saved.sources) !== JSON.stringify(draft);

  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/admin/sources', { cache: 'no-store', signal });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '配置读取失败');
      setSaved(data);
      setDraft(data.sources);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '配置读取失败');
    } finally { if (!signal?.aborted) setBusy(false); }
  }, [onSessionExpired]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const save = async () => {
    if (!saved) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: draft, revision: saved.revision }),
      });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      setSaved(data);
      setDraft(data.sources);
      setMessage('已保存。观看网页和应用刷新配置后生效。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const update = (index: number, patch: Partial<SourceConfig>) => {
    setDraft((current) => current.map((source, i) => i === index ? { ...source, ...patch } : source));
    setMessage('');
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap justify-between gap-4 items-start">
        <div><h2 className="text-xl font-semibold">点播源管理 <span className="text-sm text-muted font-normal">{draft.length} 个</span></h2><p className="mt-2 text-sm text-muted">在此统一维护电影和剧集来源，观看端无需配置。</p></div>
        <button className="btn-ghost" disabled={busy || dirty} onClick={() => void load()}>重新加载</button>
      </div>
      {error && <p role="alert" className="rounded-lg p-3 text-sm bg-danger/10 text-danger">{error}</p>}
      {message && <p role="status" className="rounded-lg p-3 text-sm bg-success/10 text-success">{message}</p>}
      {busy && !saved && <p className="text-sm text-muted">正在加载源配置…</p>}
      {saved && <fieldset disabled={busy} className="space-y-4">
        {!draft.length && <div className="card p-8 text-center"><p>还没有点播源</p><p className="text-sm text-muted mt-2">添加接口地址并保存，所有观看端即可使用。</p></div>}
        {draft.map((source, index) => <div key={source.key} className="card p-5 space-y-4">
          <div className="flex justify-between gap-3 items-center"><h3 className="font-medium">{source.name || '新点播源'}</h3><button className="btn-ghost text-danger" onClick={() => { setDraft((current) => current.filter((_, i) => i !== index)); setMessage(''); }}>移除</button></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">名称<input className="input w-full mt-2" value={source.name} maxLength={100} onChange={(event) => update(index, { name: event.target.value })} /></label>
            <label className="block text-sm">接口地址<input className="input w-full mt-2" type="url" value={source.url} placeholder="https://…/api.php/provide/vod" maxLength={2048} onChange={(event) => update(index, { url: event.target.value })} /></label>
            <label className="block text-sm sm:col-span-2">详情页地址（可选）<input className="input w-full mt-2" type="url" value={source.detail ?? ''} maxLength={2048} onChange={(event) => update(index, { detail: event.target.value })} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={source.isAdult === true} onChange={(event) => update(index, { isAdult: event.target.checked })} />成人内容源</label>
        </div>)}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button className="btn-ghost" disabled={draft.length >= 50} onClick={() => { setDraft((current) => [...current, { key: `server_${crypto.randomUUID()}`, name: '', url: '' }]); setMessage(''); }}>添加点播源</button>
          <button className="btn-primary" disabled={!dirty} onClick={() => void save()}>{busy ? '保存中…' : '保存更改'}</button>
          {dirty && <><button className="btn-ghost" onClick={() => { setDraft(saved.sources); setError(''); setMessage(''); }}>撤销未保存改动</button><span className="text-sm text-warning">有未保存的改动</span></>}
        </div>
      </fieldset>}
    </section>
  );
}
