'use client';

import { useCallback, useEffect, useState } from 'react';
import { RECOMMENDATION_PROVIDERS, DEFAULT_MAPPING, presetFeeds, type RecommendationFeed, type RecommendationMapping, type RecommendationConfig, type RecommendationSource, type RecommendationSnapshot } from '@/lib/recommendation-config';

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
          <h3 className="font-medium">{source.name}</h3>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={index === 0} aria-label={`上移${source.name}`} onClick={() => move(index, -1)}>上移</button>
            <button className="btn-ghost" disabled={index === draft.sources.length - 1} aria-label={`下移${source.name}`} onClick={() => move(index, 1)}>下移</button>
            <button className="btn-ghost text-danger" onClick={() => changeSources(draft.sources.filter((_, i) => i !== index))}>移除</button>
          </div>
        </div>
        <label className="block text-sm">显示名称<input className="input w-full mt-2" maxLength={50} value={source.name} onChange={(event) => changeSources(draft.sources.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></label>
        <div className="space-y-3">
          <p className="text-sm text-muted">分类接口与解析规则（{source.feeds?.length ?? 0} 个）</p>
          {(source.feeds ?? []).map((feed, feedIndex) => <FeedEditor key={feed.id} feed={feed} onSessionExpired={onSessionExpired}
            onChange={(next) => changeSources(draft.sources.map((item, i) => i === index ? { ...item, feeds: item.feeds?.map((value, j) => j === feedIndex ? next : value) } : item))}
            onRemove={() => changeSources(draft.sources.map((item, i) => i === index ? { ...item, feeds: item.feeds?.filter((_, j) => j !== feedIndex) } : item))}
            onMove={(step) => { const feeds = [...(source.feeds ?? [])]; [feeds[feedIndex], feeds[feedIndex + step]] = [feeds[feedIndex + step], feeds[feedIndex]]; changeSources(draft.sources.map((item, i) => i === index ? { ...item, feeds } : item)); }}
            first={feedIndex === 0} last={feedIndex === (source.feeds?.length ?? 0) - 1} />)}
          <button className="btn-ghost" disabled={(source.feeds?.length ?? 0) >= 50} onClick={() => changeSources(draft.sources.map((item, i) => i === index ? { ...item, feeds: [...(item.feeds ?? []), { id: crypto.randomUUID(), name: '新分类', url: '', mapping: { ...DEFAULT_MAPPING } }] } : item))}>添加分类接口</button>
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={source.enabled} onChange={(event) => changeSources(draft.sources.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item))} />启用</label>
          <label className="flex items-center gap-2"><input type="radio" name="default-recommendation" disabled={!source.enabled} checked={draft.defaultSource === source.id} onChange={() => { setDraft({ ...draft, defaultSource: source.id }); setMessage(''); }} />默认来源</label>
        </div>
      </div>)}
      {!draft.sources.some((source) => source.enabled) && <p className="text-sm text-muted">当前没有启用的来源，保存后观看端将隐藏首页推荐。</p>}
      {!!available.length && <div className="flex flex-wrap gap-2 items-center"><span className="text-sm text-muted">添加来源：</span>{available.map((source) => <button key={source.id} className="btn-ghost" onClick={() => changeSources([...draft.sources, { ...source, enabled: true, feeds: presetFeeds(source.id) }])}>{source.name}</button>)}</div>}
      <button className="btn-ghost" disabled={draft.sources.length >= 30} onClick={() => changeSources([...draft.sources, { id: `source_${crypto.randomUUID()}`, name: '新推荐来源', enabled: true, feeds: [{ id: 'default', name: '推荐', url: '', mapping: { ...DEFAULT_MAPPING } }] }])}>添加推荐来源</button>
      <div className="flex items-center gap-3 border-t border-line pt-5">
        <button className="btn-primary" disabled={!dirty} onClick={() => void save()}>{busy ? '保存中…' : '保存更改'}</button>
        {dirty && <button className="btn-ghost" onClick={() => { setDraft({ sources: saved.sources, defaultSource: saved.defaultSource }); setError(''); setMessage(''); }}>撤销未保存改动</button>}
      </div>
    </fieldset>}
  </section>;
}

function FeedEditor({ feed, onChange, onRemove, onMove, first, last, onSessionExpired }: {
  feed: RecommendationFeed; onChange: (feed: RecommendationFeed) => void; onRemove: () => void;
  onMove: (step: number) => void; first: boolean; last: boolean; onSessionExpired: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ fingerprint: string; message: string; titles?: string[] } | null>(null);
  const fingerprint = JSON.stringify(feed);
  const mapping = feed.mapping ?? DEFAULT_MAPPING;
  const mapField = (key: keyof RecommendationMapping, value: string) => onChange({ ...feed, mapping: { ...mapping, [key]: value } });
  const test = async () => {
    setTesting(true); setResult(null);
    try {
      const res = await fetch('/api/admin/recommendations/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feed }) });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '测试失败');
      setResult({ fingerprint, message: `测试成功：${data.count} 条推荐`, titles: data.items.map((item: { title: string }) => item.title) });
    } catch (cause) { setResult({ fingerprint, message: cause instanceof Error ? cause.message : '测试失败' }); }
    finally { setTesting(false); }
  };
  return <details className="rounded-lg border border-line p-3">
    <summary className="cursor-pointer text-sm font-medium">{feed.group ? `${feed.group} / ` : ''}{feed.name} · 编辑接口和字段</summary>
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">分类名称<input className="input w-full mt-1" maxLength={50} value={feed.name} onChange={(e) => onChange({ ...feed, name: e.target.value })} /></label>
        <label className="text-sm">分组名称（可选）<input className="input w-full mt-1" maxLength={50} value={feed.group ?? ''} placeholder="例如：电影、剧集" onChange={(e) => onChange({ ...feed, group: e.target.value })} /></label>
      </div>
      <label className="block text-sm">接口地址<input className="input w-full mt-1" type="url" maxLength={2048} value={feed.url ?? ''} placeholder="https://example.com/recommend.json" onChange={(e) => onChange({ ...feed, url: e.target.value })} /></label>
      <details className="text-sm"><summary className="cursor-pointer text-muted">备用接口（可选）</summary><textarea className="input w-full mt-2" rows={3} value={(feed.fallbackUrls ?? []).join('\n')} placeholder="每行一个地址，最多 3 个，按顺序尝试" onChange={(e) => onChange({ ...feed, fallbackUrls: e.target.value.split('\n').filter(Boolean) })} /></details>
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted">字段模板：</span>
        <button className="btn-ghost" onClick={() => onChange({ ...feed, mapping: { ...DEFAULT_MAPPING } })}>通用 JSON</button>
        <button className="btn-ghost" onClick={() => onChange({ ...feed, mapping: { listPath: 'list', titlePath: 'vod_name', coverPath: 'vod_pic', idPath: 'vod_id', ratingPath: 'vod_score' } })}>苹果 CMS</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {([['listPath', '列表路径'], ['titlePath', '片名字段'], ['coverPath', '海报字段'], ['idPath', '影片编号字段（可选）'], ['ratingPath', '评分字段（可选）'], ['filterPath', '顶层分组筛选字段（可选）'], ['filterValue', '分组筛选值（可选）']] as const).map(([key, name]) => <label key={key} className="text-sm">{name}<input className="input w-full mt-1" maxLength={200} value={mapping[key] ?? ''} onChange={(e) => mapField(key, e.target.value)} /></label>)}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mapping.httpsCover === true} onChange={(e) => onChange({ ...feed, mapping: { ...mapping, httpsCover: e.target.checked } })} />将海报地址升级为 HTTPS（需图床支持）</label>
      <p className="text-xs text-muted">例如返回 {'items: [{title, cover}]'} 时，列表填 items，片名填 title，海报填 cover。嵌套用点号（如 data.list、images.large）；* 展开数组；| 表示备用字段（如 name_cn|name）。顶层就是列表时，列表路径留空。只支持公开 HTTP/HTTPS JSON 接口。</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" disabled={testing} onClick={() => void test()}>{testing ? '测试中…' : '测试并预览'}</button>
        <button className="btn-ghost" disabled={first} onClick={() => onMove(-1)}>分类上移</button><button className="btn-ghost" disabled={last} onClick={() => onMove(1)}>分类下移</button>
        <button className="btn-ghost text-danger" disabled={first && last} onClick={onRemove}>移除分类</button>
      </div>
      {result?.fingerprint === fingerprint && <div role="status" className="rounded-lg bg-chip p-3 text-sm"><p>{result.message}</p>{result.titles && <ul className="mt-2 space-y-1">{result.titles.map((title, i) => <li key={i}>{title}</li>)}</ul>}</div>}
    </div>
  </details>;
}
