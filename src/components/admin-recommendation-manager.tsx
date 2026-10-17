'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ConfirmDialog } from './confirm-dialog';
import { RECOMMENDATION_PROVIDERS, DEFAULT_MAPPING, presetFeeds, type RecommendationFeed, type RecommendationMapping, type RecommendationConfig, type RecommendationSource, type RecommendationSnapshot } from '@/lib/recommendation-config';

function reconcile(sources: RecommendationSource[], preferred: string | null): RecommendationConfig {
  return { sources, defaultSource: sources.find((source) => source.enabled && source.id === preferred)?.id ?? sources.find((source) => source.enabled)?.id ?? null };
}
function sourceChanged(source: RecommendationSource, saved: RecommendationSnapshot | null) {
  return JSON.stringify(source) !== JSON.stringify(saved?.sources.find((item) => item.id === source.id));
}
type Confirmation = { title: string; message: string; action: () => void };

export function AdminRecommendationManager({ onSessionExpired }: { onSessionExpired: () => void }) {
  const router = useRouter();
  const sourceId = useSearchParams().get('source');
  const [saved, setSaved] = useState<RecommendationSnapshot | null>(null);
  const [draft, setDraft] = useState<RecommendationConfig>({ sources: [], defaultSource: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const dirty = !!saved && JSON.stringify({ sources: saved.sources, defaultSource: saved.defaultSource }) !== JSON.stringify(draft);
  const source = draft.sources.find((item) => item.id === sourceId);
  const navigate = (id?: string) => {
    router.push(`/admin?tab=recommendations${id ? `&source=${encodeURIComponent(id)}` : ''}`, { scroll: false });
    window.scrollTo({ top: 0 });
  };
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/recommendations', { cache: 'no-store', signal });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '推荐配置读取失败');
      setSaved(data); setDraft({ sources: data.sources, defaultSource: data.defaultSource });
      setEditorVersion((version) => version + 1);
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '推荐配置读取失败'); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [onSessionExpired]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const save = async () => {
    if (!saved) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/admin/recommendations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, revision: saved.revision }) });
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '推荐配置保存失败');
      setSaved(data); setDraft({ sources: data.sources, defaultSource: data.defaultSource });
      setMessage('已保存，观看网页和应用会自动同步。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const changeSources = (sources: RecommendationSource[]) => { setDraft(reconcile(sources, draft.defaultSource)); setMessage(''); setError(''); };
  const changeSource = (next: RecommendationSource) => changeSources(draft.sources.map((item) => item.id === next.id ? next : item));
  const moveSource = (index: number, step: number) => {
    const next = [...draft.sources];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    changeSources(next);
  };
  const setDefault = (id: string) => { setDraft({ ...draft, defaultSource: id }); setMessage(''); };
  const addSource = (preset?: typeof RECOMMENDATION_PROVIDERS[number]) => {
    const next: RecommendationSource = preset
      ? { ...preset, enabled: true, feeds: presetFeeds(preset.id) }
      : { id: `source_${crypto.randomUUID()}`, name: '新推荐来源', enabled: true, feeds: [{ id: 'default', name: '推荐', url: '', mapping: { ...DEFAULT_MAPPING } }] };
    changeSources([...draft.sources, next]); navigate(next.id);
  };
  const undo = () => {
    if (!saved) return;
    setDraft({ sources: saved.sources, defaultSource: saved.defaultSource }); setError(''); setMessage('');
    setEditorVersion((value) => value + 1);
    if (sourceId && !saved.sources.some((item) => item.id === sourceId)) navigate();
  };
  const available = RECOMMENDATION_PROVIDERS.filter(({ id }) => !draft.sources.some((item) => item.id === id));

  return <section className="space-y-6 pb-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {sourceId && <nav aria-label="推荐管理位置" className="flex items-center gap-2 text-sm text-muted mb-3"><button className="hover:text-accent" onClick={() => navigate()}>推荐来源</button><span aria-hidden>›</span><span className="text-content">{source?.name || '编辑来源'}</span></nav>}
        <h2 className="text-2xl font-semibold tracking-tight">{sourceId ? source?.name || '来源不存在' : '推荐来源'}</h2>
        <p className="mt-2 text-sm text-muted">{sourceId ? '先选择分类，再编辑接口。返回列表时会保留未保存的改动。' : '先选择要管理的来源，再进入各自的编辑页。'}</p>
      </div>
      <button className="btn-ghost text-sm" disabled={busy} onClick={() => dirty ? setConfirmation({ title: '重新加载配置？', message: '未保存的改动会被放弃，并读取服务器上的最新配置。', action: () => void load() }) : void load()}>重新加载</button>
    </div>
    {error && <p role="alert" className="rounded-xl border border-danger/20 bg-danger/10 p-4 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-success/20 bg-success/10 p-4 text-sm text-success">{message}</p>}
    {!saved && busy && <p className="text-sm text-muted py-10">正在读取推荐配置…</p>}
    {saved && <fieldset disabled={busy} className="space-y-6 min-w-0">
      {!sourceId ? <>
        <div className="flex items-center justify-between border-b border-line pb-4"><p className="text-sm text-muted"><strong className="text-content font-semibold">{draft.sources.length}</strong> 个来源<span className="mx-2">·</span>{draft.sources.filter((item) => item.enabled).length} 个已启用</p><button className="btn-primary text-sm" disabled={draft.sources.length >= 30} onClick={() => addSource()}>＋ 添加来源</button></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {draft.sources.map((item, index) => {
            const groups = [...new Set(item.feeds?.map((feed) => feed.group).filter(Boolean) ?? [])];
            return <article key={item.id} className="card overflow-hidden flex flex-col border border-line transition-colors hover:border-accent/40">
              <button className="text-left p-5 pb-4 flex-1 w-full group" aria-label={`编辑${item.name}`} onClick={() => navigate(item.id)}>
                <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-2"><h3 className="min-w-0 rounded-xl bg-accent/10 px-3 py-2 text-accent font-semibold text-lg break-words">{item.name || '未命名来源'}</h3>{draft.defaultSource === item.id && <span className="text-xs rounded-md bg-accent/10 text-accent px-2 py-0.5">默认</span>}</div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${item.enabled ? 'bg-success/10 text-success' : 'bg-chip text-muted'}`}>{item.enabled ? '已启用' : '已停用'}</span></div>
                <p className="mt-4 text-sm text-muted">{item.feeds?.length ?? 0} 个分类{groups.length ? ` · ${groups.join(' / ')}` : ''}</p>
                <p className="mt-5 text-sm font-medium text-accent">进入编辑 <span aria-hidden>→</span></p>
              </button>
              <div className="flex items-center justify-between gap-2 border-t border-line bg-chip/30 px-4 py-3">
                <div className="flex gap-1"><button className="btn-ghost !px-2 !py-1" aria-label={`上移${item.name}`} disabled={index === 0} onClick={() => moveSource(index, -1)}>↑</button><button className="btn-ghost !px-2 !py-1" aria-label={`下移${item.name}`} disabled={index === draft.sources.length - 1} onClick={() => moveSource(index, 1)}>↓</button></div>
                <span className="text-xs text-warning">{sourceChanged(item, saved) ? '未保存' : ''}</span>
                <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" aria-label={`启用${item.name}`} checked={item.enabled} onChange={(event) => changeSource({ ...item, enabled: event.target.checked })} />启用</label>
              </div>
            </article>;
          })}
        </div>
        {!draft.sources.length && <div className="card border border-dashed border-line py-14 text-center"><p className="font-medium">还没有推荐来源</p><p className="text-sm text-muted mt-2">添加一个来源，或从下方的预置开始。</p></div>}
        {!!available.length && <details className="rounded-xl border border-dashed border-line p-4"><summary className="text-sm text-muted cursor-pointer">从预置添加来源</summary><div className="flex flex-wrap gap-2 mt-3">{available.map((item) => <button key={item.id} className="btn-ghost text-sm" disabled={draft.sources.length >= 30} onClick={() => addSource(item)}>＋ {item.name}</button>)}</div></details>}
        {!draft.sources.some((item) => item.enabled) && <p className="text-sm text-muted">当前没有启用的来源，保存后观看端将隐藏首页推荐。</p>}
      </> : source ? <SourceEditor key={`${source.id}:${editorVersion}`} source={source} isDefault={draft.defaultSource === source.id}
        onChange={changeSource} onSetDefault={() => setDefault(source.id)} onSessionExpired={onSessionExpired}
        confirm={setConfirmation} onRemove={() => setConfirmation({ title: `移除 ${source.name}？`, message: '该来源及其分类将从列表移除，保存后对观看端生效。保存前仍可撤销改动。', action: () => { changeSources(draft.sources.filter((item) => item.id !== source.id)); navigate(); } })} />
        : <div className="card p-8 text-center space-y-4"><p className="text-muted">该来源已被移除，或当前配置中不存在。</p><button className="btn-ghost" onClick={() => navigate()}>返回来源列表</button></div>}
      <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 p-3 sm:px-5 shadow-lg backdrop-blur">
        <p className={`text-sm ${dirty ? 'text-warning' : 'text-muted'}`}>{busy ? '正在保存…' : dirty ? '有未保存的改动' : '配置已保存'}<span className="hidden sm:inline text-muted ml-2">保存后同步到观看端</span></p>
        <div className="flex items-center gap-2">{dirty && <button className="btn-ghost text-sm" onClick={() => setConfirmation({ title: '撤销未保存的改动？', message: '所有来源会恢复到上次保存的状态。', action: undo })}>撤销改动</button>}{sourceId && <button className="btn-ghost text-sm" onClick={() => navigate()}>返回列表</button>}<button className="btn-primary text-sm" disabled={!dirty || busy} onClick={() => void save()}>{busy ? '保存中…' : '保存更改'}</button></div>
      </div>
    </fieldset>}
    <ConfirmDialog open={!!confirmation} title={confirmation?.title || ''} message={confirmation?.message} danger confirmLabel="确认" onCancel={() => setConfirmation(null)} onConfirm={() => { const action = confirmation?.action; setConfirmation(null); action?.(); }} />
  </section>;
}

function SourceEditor({ source, isDefault, onChange, onSetDefault, onRemove, onSessionExpired, confirm }: {
  source: RecommendationSource; isDefault: boolean; onChange: (source: RecommendationSource) => void;
  onSetDefault: () => void; onRemove: () => void; onSessionExpired: () => void; confirm: (value: Confirmation) => void;
}) {
  const feeds = source.feeds ?? [];
  const groups = [...new Set(feeds.map((feed) => feed.group || ''))];
  const [expanded, setExpanded] = useState(() => new Set(groups.length === 1 ? groups : []));
  const [openFeed, setOpenFeed] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = feeds.filter((feed) => `${feed.group || ''} ${feed.name}`.toLowerCase().includes(query));
  const visibleGroups = groups.filter((group) => visible.some((feed) => (feed.group || '') === group));
  const openGroup = (group: string) => setExpanded((current) => new Set([...current, group]));
  const updateFeed = (next: RecommendationFeed) => {
    if (next.group !== feeds.find((feed) => feed.id === next.id)?.group) openGroup(next.group || '');
    onChange({ ...source, feeds: feeds.map((feed) => feed.id === next.id ? next : feed) });
  };
  const addFeed = (group: string, after?: RecommendationFeed) => {
    const next: RecommendationFeed = after ? { ...after, id: crypto.randomUUID(), name: `${after.name.slice(0, 45)} 副本` } : { id: crypto.randomUUID(), name: '新分类', group, url: '', mapping: { ...DEFAULT_MAPPING } };
    const updated = [...feeds]; updated.splice(after ? feeds.findIndex((feed) => feed.id === after.id) + 1 : feeds.length, 0, next);
    onChange({ ...source, feeds: updated }); openGroup(next.group || ''); setOpenFeed(next.id); setSearch('');
  };
  const moveFeed = (feed: RecommendationFeed, step: number) => {
    const siblings = feeds.filter((item) => (item.group || '') === (feed.group || ''));
    const neighbor = siblings[siblings.findIndex((item) => item.id === feed.id) + step];
    if (!neighbor) return;
    const updated = [...feeds]; const a = feeds.indexOf(feed), b = feeds.indexOf(neighbor);
    [updated[a], updated[b]] = [updated[b], updated[a]]; onChange({ ...source, feeds: updated });
  };
  return <>
    <div className="card border border-line p-5 sm:p-6 grid gap-5 sm:grid-cols-[1fr_auto] items-end">
      <label className="block text-sm font-medium">来源名称<input className="input w-full mt-2" maxLength={50} value={source.name} onChange={(event) => onChange({ ...source, name: event.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-4 pb-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={source.enabled} onChange={(event) => onChange({ ...source, enabled: event.target.checked })} />启用来源</label><label className="flex items-center gap-2"><input type="radio" name="default-recommendation" checked={isDefault} disabled={!source.enabled} onChange={onSetDefault} />设为默认</label></div>
    </div>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">分类管理 <span className="ml-2 text-sm text-muted font-normal">{feeds.length} 个分类</span></h3><p className="text-sm text-muted mt-1">按分组浏览，展开一个分类即可编辑。</p></div><button className="btn-ghost text-sm" disabled={feeds.length >= 50} onClick={() => addFeed('')}>＋ 添加分类</button></div>
      <div className="flex flex-wrap items-center gap-2"><label className="flex-1 min-w-40"><span className="sr-only">搜索分类</span><input className="input w-full" placeholder="搜索分类或分组…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="btn-ghost text-xs" onClick={() => setExpanded(new Set(groups))}>展开分组</button><button className="btn-ghost text-xs" onClick={() => { setExpanded(new Set()); setOpenFeed(null); setSearch(''); }}>收起全部</button></div>
      {visibleGroups.map((group) => {
        const siblings = feeds.filter((feed) => (feed.group || '') === group);
        const matching = visible.filter((feed) => (feed.group || '') === group);
        const isOpen = !!query || expanded.has(group);
        return <section key={group} className="rounded-xl border border-line overflow-hidden">
          <button className="w-full flex items-center gap-3 bg-chip/50 px-4 py-4 text-left hover:bg-hover transition-colors" aria-label={`${isOpen ? '收起' : '展开'}${group || '全部分类'}`} aria-expanded={isOpen} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; })}><span aria-hidden className={`text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span><span className="font-medium flex-1">{group || (groups.length === 1 ? '全部分类' : '未分组')}</span><span className="text-xs rounded-full bg-surface px-2 py-1 text-muted">{matching.length} 个分类</span></button>
          {isOpen && <div className="bg-card p-2 sm:p-3 space-y-2">{matching.map((feed) => <FeedEditor key={feed.id} feed={feed} groups={groups} open={openFeed === feed.id} onToggle={() => setOpenFeed(openFeed === feed.id ? null : feed.id)} onChange={updateFeed} onDuplicate={() => addFeed(group, feed)}
            first={siblings[0]?.id === feed.id} last={siblings[siblings.length - 1]?.id === feed.id} onMove={(step) => moveFeed(feed, step)}
            canAdd={feeds.length < 50} canRemove={feeds.length > 1} onSessionExpired={onSessionExpired} onRemove={() => confirm({ title: `移除分类 ${feed.name}？`, message: '保存后此分类将从观看端移除，保存前可撤销。', action: () => { onChange({ ...source, feeds: feeds.filter((item) => item.id !== feed.id) }); if (openFeed === feed.id) setOpenFeed(null); } })} />)}
            <button className="w-full rounded-lg border border-dashed border-line py-3 text-sm text-muted hover:text-accent hover:border-accent/40" disabled={feeds.length >= 50} onClick={() => addFeed(group)}>＋ 在{group || '此分组'}中添加分类</button>
          </div>}
        </section>;
      })}
      {!visible.length && <p className="card p-8 text-center text-muted text-sm">没有匹配的分类，试试其他关键词。</p>}
    </div>
    <details className="text-sm border-t border-line pt-4"><summary className="cursor-pointer text-muted">来源管理</summary><p className="text-muted text-xs mt-3 mb-2">移除整个来源及其分类，保存后生效。</p><button className="btn-ghost text-danger text-sm" onClick={onRemove}>移除此来源</button></details>
  </>;
}

function FeedEditor({ feed, groups, open, onToggle, onChange, onRemove, onDuplicate, onMove, first, last, canAdd, canRemove, onSessionExpired }: {
  feed: RecommendationFeed; groups: string[]; open: boolean; onToggle: () => void; onChange: (feed: RecommendationFeed) => void; onRemove: () => void; onDuplicate: () => void;
  onMove: (step: number) => void; first: boolean; last: boolean; canAdd: boolean; canRemove: boolean; onSessionExpired: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [groupDraft, setGroupDraft] = useState(feed.group || '');
  const [result, setResult] = useState<{ fingerprint: string; message: string; titles?: string[] } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const fingerprint = JSON.stringify(feed);
  const mapping = feed.mapping ?? DEFAULT_MAPPING;
  const mapField = (key: keyof RecommendationMapping, value: string) => onChange({ ...feed, mapping: { ...mapping, [key]: value } });
  const host = (() => { try { return new URL(feed.url || '').host; } catch { return ''; } })();
  const test = async () => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setTesting(true); setResult(null);
    try {
      const res = await fetch('/api/admin/recommendations/preview', { method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feed }) });
      if (request.signal.aborted) return;
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '测试失败');
      setResult({ fingerprint, message: `测试成功 · ${data.count} 条推荐`, titles: data.items.map((item: { title: string }) => item.title) });
    } catch (cause) { if (!request.signal.aborted) setResult({ fingerprint, message: cause instanceof Error ? cause.message : '测试失败' }); }
    finally { if (!request.signal.aborted) setTesting(false); }
  };
  return <div className={`rounded-lg border transition-colors ${open ? 'border-accent/40 bg-surface shadow-sm' : 'border-line bg-surface/50'}`}>
    <button className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-hover rounded-lg" aria-expanded={open} aria-controls={`feed-panel-${feed.id}`} aria-label={`编辑分类${feed.name}`} onClick={onToggle}><span aria-hidden className={`text-muted transition-transform ${open ? 'rotate-90 text-accent' : ''}`}>›</span><span className="flex-1 min-w-0"><span className="block text-sm font-medium">{feed.name || '未命名分类'}</span><span className="block text-xs text-muted mt-0.5 truncate">{host || '尚未填写接口地址'}</span></span><span className="text-xs text-muted">{open ? '收起' : '编辑'}</span></button>
    {open && <div id={`feed-panel-${feed.id}`} className="border-t border-line p-4 sm:p-5 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">分类名称<input className="input w-full mt-2" maxLength={50} value={feed.name} onChange={(event) => onChange({ ...feed, name: event.target.value })} /></label><label className="text-sm">所属分组<input className="input w-full mt-2" list={`feed-groups-${feed.id}`} maxLength={50} value={groupDraft} placeholder="留空表示未分组" onChange={(event) => setGroupDraft(event.target.value)} /><datalist id={`feed-groups-${feed.id}`}>{groups.filter(Boolean).map((name) => <option key={name} value={name} />)}</datalist>{groupDraft !== (feed.group || '') && <button className="btn-ghost text-xs mt-2" onClick={() => onChange({ ...feed, group: groupDraft.trim() })}>移到此分组 →</button>}</label></div>
      <label className="block text-sm">接口地址<input className="input w-full mt-2 font-mono text-xs" type="url" maxLength={2048} value={feed.url || ''} placeholder="https://example.com/recommend.json" onChange={(event) => onChange({ ...feed, url: event.target.value })} /></label>
      <details className="rounded-lg border border-line p-3 sm:p-4"><summary className="cursor-pointer text-sm font-medium">数据解析 · 字段对应关系</summary><div className="mt-4 space-y-4">
        <p className="text-xs text-muted">已有来源通常不需要改。接口格式发生变化时，再调整下面的对应关系。</p>
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted">快速填写：</span><button className="btn-ghost text-xs" onClick={() => onChange({ ...feed, mapping: { ...DEFAULT_MAPPING } })}>通用 JSON</button><button className="btn-ghost text-xs" onClick={() => onChange({ ...feed, mapping: { listPath: 'list', titlePath: 'vod_name', coverPath: 'vod_pic', idPath: 'vod_id', ratingPath: 'vod_score' } })}>苹果 CMS</button></div>
        <div className="grid gap-4 sm:grid-cols-2">{([['listPath', '影片列表路径'], ['titlePath', '片名字段'], ['coverPath', '海报字段'], ['idPath', '影片编号（可选）'], ['ratingPath', '评分（可选）']] as const).map(([key, name]) => <label key={key} className="text-sm">{name}<input className="input w-full mt-2 font-mono text-xs" maxLength={200} value={mapping[key] || ''} onChange={(event) => mapField(key, event.target.value)} /></label>)}</div>
        <p className="text-xs text-muted leading-relaxed">嵌套字段用点号，例如 data.list、images.large；* 展开数组；| 表示备用字段。列表在最外层时，列表路径留空。</p>
      </div></details>
      <details className="rounded-lg border border-line p-3 sm:p-4"><summary className="cursor-pointer text-sm font-medium">高级设置 · 备用接口与筛选</summary><div className="mt-4 space-y-4">
        <label className="block text-sm">备用接口<textarea className="input w-full mt-2 font-mono text-xs" rows={3} value={(feed.fallbackUrls || []).join('\n')} placeholder="每行一个地址，最多 3 个" onChange={(event) => onChange({ ...feed, fallbackUrls: event.target.value.split('\n').filter(Boolean) })} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">分组筛选字段（可选）<input className="input w-full mt-2" maxLength={200} value={mapping.filterPath || ''} onChange={(event) => mapField('filterPath', event.target.value)} /></label><label className="text-sm">筛选值（可选）<input className="input w-full mt-2" maxLength={100} value={mapping.filterValue || ''} onChange={(event) => mapField('filterValue', event.target.value)} /></label></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mapping.httpsCover === true} onChange={(event) => onChange({ ...feed, mapping: { ...mapping, httpsCover: event.target.checked } })} />海报地址使用 HTTPS（需图床支持）</label>
      </div></details>
      <div className="flex flex-wrap items-center gap-2"><button className="btn-primary text-sm" disabled={testing} onClick={() => void test()}>{testing ? '测试中…' : '测试并预览'}</button><button className="btn-ghost text-sm" disabled={!canAdd} onClick={onDuplicate}>复制分类</button><div className="ml-auto flex gap-1"><button className="btn-ghost text-sm" disabled={first} aria-label={`上移分类${feed.name}`} onClick={() => onMove(-1)}>↑</button><button className="btn-ghost text-sm" disabled={last} aria-label={`下移分类${feed.name}`} onClick={() => onMove(1)}>↓</button><button className="btn-ghost text-sm text-danger" disabled={!canRemove} onClick={onRemove}>移除</button></div></div>
      {result?.fingerprint === fingerprint && <div role="status" className={`rounded-lg border p-4 text-sm ${result.titles ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'}`}><p className={result.titles ? 'text-success font-medium' : 'text-danger'}>{result.message}</p>{result.titles && <ul className="mt-3 divide-y divide-line">{result.titles.map((title, i) => <li className="py-2 last:pb-0" key={i}><span className="text-muted mr-3">{i + 1}.</span>{title}</li>)}</ul>}</div>}
    </div>}
  </div>;
}
