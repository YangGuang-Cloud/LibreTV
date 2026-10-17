'use client';

import { useCallback, useEffect, useState } from 'react';
import { RECOMMENDATION_PROVIDERS, type RecommendationConfig, type RecommendationSource, type RecommendationSnapshot } from '@/lib/recommendation-config';

function reconcile(sources: RecommendationSource[], preferred: RecommendationConfig['defaultSource']): RecommendationConfig {
  return { sources, defaultSource: sources.find((source) => source.enabled && source.id === preferred)?.id ?? sources.find((source) => source.enabled)?.id ?? null };
}
export function AdminRecommendationManager({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [saved, setSaved] = useState<RecommendationSnapshot | null>(null);
  const [draft, setDraft] = useState<RecommendationConfig>({ sources: [], defaultSource: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirty = !!saved && JSON.stringify({ sources: saved.sources, defaultSource: saved.defaultSource }) !== JSON.stringify(draft);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/recommendations', { cache: 'no-store', signal });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '推荐配置读取失败');
      setSaved(data); setDraft({ sources: data.sources, defaultSource: data.defaultSource });
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '推荐配置读取失败'); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [onSessionExpired]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const save = async () => {
    if (!saved) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/recommendations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, revision: saved.revision }) });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '推荐配置保存失败');
      setSaved(data); setDraft({ sources: data.sources, defaultSource: data.defaultSource });
      setMessage('已保存，观看端会自动同步。网页约 1 分钟内更新，应用在前台刷新配置后更新。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const changeSources = (sources: RecommendationSource[]) => { setDraft(reconcile(sources, draft.defaultSource)); setMessage(''); };
  const move = (index: number, step: number) => {
    const next = [...draft.sources];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    changeSources(next);
  };
  const available = RECOMMENDATION_PROVIDERS.filter(({ id }) => !draft.sources.some((source) => source.id === id));
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">首页推荐</h2><p className="mt-2 text-sm text-muted">统一管理网页和应用里的推荐来源。默认来源用于尚未选择来源的用户；已停用的来源会自动切换到可用项。</p></div>
      <button className="btn-ghost" disabled={busy} onClick={() => void load()}>重新加载{dirty ? '并放弃改动' : ''}</button>
    </div>
    {error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">{message}</p>}
    {!saved && busy && <p className="text-sm text-muted">正在读取推荐配置…</p>}
    {saved && <fieldset disabled={busy} className="space-y-4">
      {draft.sources.map((source, index) => <div key={source.id} className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium">{RECOMMENDATION_PROVIDERS.find(({ id }) => id === source.id)?.name}</h3>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={index === 0} aria-label={`上移${source.name}`} onClick={() => move(index, -1)}>上移</button>
            <button className="btn-ghost" disabled={index === draft.sources.length - 1} aria-label={`下移${source.name}`} onClick={() => move(index, 1)}>下移</button>
            <button className="btn-ghost text-danger" onClick={() => changeSources(draft.sources.filter((_, i) => i !== index))}>移除</button>
          </div>
        </div>
        <label className="block text-sm">显示名称<input className="input w-full mt-2" maxLength={50} value={source.name} onChange={(event) => changeSources(draft.sources.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></label>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={source.enabled} onChange={(event) => changeSources(draft.sources.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item))} />启用</label>
          <label className="flex items-center gap-2"><input type="radio" name="default-recommendation" disabled={!source.enabled} checked={draft.defaultSource === source.id} onChange={() => { setDraft({ ...draft, defaultSource: source.id }); setMessage(''); }} />默认来源</label>
        </div>
      </div>)}
      {!draft.sources.some((source) => source.enabled) && <p className="text-sm text-muted">当前没有启用的来源，保存后观看端将隐藏首页推荐。</p>}
      {!!available.length && <div className="flex flex-wrap gap-2 items-center"><span className="text-sm text-muted">添加来源：</span>{available.map((source) => <button key={source.id} className="btn-ghost" onClick={() => changeSources([...draft.sources, { ...source, enabled: true }])}>{source.name}</button>)}</div>}
      <div className="flex items-center gap-3 border-t border-line pt-5">
        <button className="btn-primary" disabled={!dirty} onClick={() => void save()}>{busy ? '保存中…' : '保存更改'}</button>
        {dirty && <button className="btn-ghost" onClick={() => { setDraft({ sources: saved.sources, defaultSource: saved.defaultSource }); setError(''); setMessage(''); }}>撤销未保存改动</button>}
      </div>
    </fieldset>}
  </section>;
}
