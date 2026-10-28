'use client';

import { useEffect, useState } from 'react';
import type { SourceConfig, SearchResultItem, VideoDetail } from '@/lib/types';
import type { EpisodeSnapshot } from '@/lib/episode-metadata';
import type { MetadataCandidate } from '@/lib/episode-providers';
import { formatEpisodeLabel, meaningfulEpisodeTitle } from '@/lib/episode-title';

interface Snapshot extends EpisodeSnapshot { raw: VideoDetail; detail: VideoDetail }

export function AdminEpisodeManager({ onSessionExpired, profileId = 'default' }: { onSessionExpired: () => void; profileId?: string }) {
  const [sources, setSources] = useState<SourceConfig[]>([]);
  const [sourceKey, setSourceKey] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selected, setSelected] = useState<SearchResultItem | null>(null);
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [manual, setManual] = useState<string[]>([]);
  const [autoDisabled, setAutoDisabled] = useState(false);
  const [provider, setProvider] = useState<'bangumi' | 'tvmaze'>('bangumi');
  const [metadataQuery, setMetadataQuery] = useState('');
  const [season, setSeason] = useState(1);
  const [candidates, setCandidates] = useState<MetadataCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/episodes?action=sources&profileId=${encodeURIComponent(profileId)}`, { cache: 'no-store', signal: controller.signal }).then(async (res) => {
      if (res.status === 401) { onSessionExpired(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '来源读取失败');
      setSources(data.sources); setSourceKey(data.sources[0]?.key ?? '');
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '来源读取失败'); });
    return () => controller.abort();
  }, [onSessionExpired, profileId]);

  async function request(body?: unknown, params?: string) {
    const searchParams = new URLSearchParams(params);
    searchParams.set('profileId', profileId);
    const res = await fetch(`/api/admin/episodes?${searchParams.toString()}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : { cache: 'no-store' });
    if (res.status === 401) { onSessionExpired(); throw new Error('后台登录已过期'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失败');
    return data;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  }
  function apply(data: Snapshot) {
    setSaved(data);
    setManual(data.raw.episodes.map((_, index) => data.stale ? '' : data.record?.manualTitles[index] ?? ''));
    setAutoDisabled(data.record?.autoDisabled ?? false);
  }
  const fallbackTitle = (index: number) => meaningfulEpisodeTitle(saved?.raw.episodeTitles?.[index]) || (saved?.stale ? '' : saved?.record?.imported?.titles[index] || '');
  const dirty = saved && (autoDisabled !== (saved.record?.autoDisabled ?? false) || manual.some((value, index) => value !== (saved.stale ? '' : saved.record?.manualTitles[index] ?? '')));
  function selectFilm(film: SearchResultItem) {
    void run(async () => {
      const data = await request(undefined, new URLSearchParams({ sourceKey: film.sourceKey, id: film.vodId }).toString());
      setSelected(film); apply(data); setMetadataQuery(film.name); setCandidates([]);
      setProvider(/动漫|动画/i.test(film.typeName ?? '') ? 'bangumi' : 'tvmaze');
    });
  }
  return <section className="space-y-5">
    <div><h2 className="text-xl font-semibold">分集资料</h2><p className="text-sm text-muted mt-2">先搜索播放源中的节目，再补充分集标题。手动修正优先，其次使用源标题，缺失时采用匹配的节目资料。</p></div>
    {error && <p role="alert" className="bg-danger/10 text-danger p-3 rounded-lg text-sm">{error}</p>}
    {message && <p role="status" className="bg-success/10 text-success p-3 rounded-lg text-sm">{message}</p>}
    <fieldset disabled={busy} className="space-y-5">
      <form className="card p-5 flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void run(async () => { setResults((await request({ action: 'search', sourceKey, query })).list); }); }}>
        <select aria-label="节目来源" className="input" value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); setResults([]); setSelected(null); setSaved(null); }}>
          {sources.map((source) => <option key={source.key} value={source.key}>{source.name}</option>)}
        </select>
        <input className="input flex-1 min-w-40" aria-label="搜索节目" placeholder="输入片名" value={query} maxLength={160} onChange={(event) => setQuery(event.target.value)} />
        <button className="btn-primary" disabled={!sourceKey || !query.trim()}>搜索节目</button>
      </form>
      {results.length > 0 && <div className="card p-4 grid gap-2 sm:grid-cols-2">{results.map((film) => <button key={`${film.sourceKey}:${film.vodId}`} className="text-left btn-ghost" onClick={() => selectFilm(film)}>
        <span>{film.name}</span><span className="text-xs text-muted ml-2">{film.year} · {film.remarks}</span>
      </button>)}</div>}
      {selected && saved && <>
        <div className="card p-5 space-y-4">
          <div><h3 className="font-semibold">{saved.raw.videoInfo.title || selected.name} <span className="text-muted text-sm font-normal">共 {saved.raw.episodes.length} 集</span></h3>
            <p className="text-sm text-muted mt-2">自动补充只接受明确匹配的节目和连续集序。国剧译名、特别篇、上下集等对不上时，可在下面手动填写。</p></div>
          {saved.stale && <p className="text-warning text-sm">播放源分集已变化，旧资料暂停使用。请核对集序后重新保存。</p>}
          <div className="flex flex-wrap gap-3">
            <select className="input" aria-label="资料提供方" value={provider} onChange={(event) => { setProvider(event.target.value as typeof provider); setCandidates([]); }}><option value="bangumi">Bangumi（动画 / 影视）</option><option value="tvmaze">TVmaze（剧集）</option></select>
            <input className="input flex-1 min-w-40" aria-label="资料搜索片名" value={metadataQuery} maxLength={160} onChange={(event) => setMetadataQuery(event.target.value)} placeholder="可尝试原文或英文片名" />
            <button className="btn-ghost" disabled={!metadataQuery.trim()} onClick={() => void run(async () => { const data = await request({ action: 'lookup', provider, query: metadataQuery }); setCandidates(data.candidates); if (!data.candidates.length) setMessage('未找到节目资料，可换个片名搜索或手动填写。'); })}>查询节目资料</button>
          </div>
          {provider === 'tvmaze' && <label className="text-sm flex items-center gap-3">导入第几季<input type="number" min={1} max={100} className="input w-24" value={season} onChange={(event) => setSeason(Number(event.target.value))} /></label>}
          {candidates.map((item) => <div className="border border-line rounded-lg p-3 flex flex-wrap justify-between gap-3 items-center" key={`${item.provider}:${item.id}`}>
            <div><a href={item.url} target="_blank" rel="noreferrer" className="text-accent">{item.title}</a><p className="text-xs text-muted">{item.originalTitle} · {item.year || '年份未知'}</p></div>
            <button className="btn-ghost text-sm" disabled={!!dirty} onClick={() => void run(async () => {
              apply(await request({ action: 'import', sourceKey: selected.sourceKey, vodId: selected.vodId, provider: item.provider, subjectId: item.id, season, revision: saved.revision }));
              setCandidates([]);
              setMessage('已导入节目分集。请检查下面的显示结果，必要时手动修正。');
            })}>确认对应此节目，导入分集</button>
          </div>)}
          {!saved.stale && saved.record?.imported && <div className="text-sm text-muted flex flex-wrap gap-3 items-center">
            <a className="text-accent" href={saved.record.imported.candidate.url} target="_blank" rel="noreferrer">分集资料：{saved.record.imported.candidate.provider} · {saved.record.imported.candidate.title}</a>
            <button className="btn-ghost text-sm" disabled={!!dirty} onClick={() => void run(async () => { apply(await request({ action: 'clear-import', sourceKey: selected.sourceKey, vodId: selected.vodId, revision: saved.revision })); setMessage('已停用该节目补充资料，手动标题仍保留。'); })}>停用补充资料</button>
          </div>}
        </div>
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold">手动修正</h3><p className="text-sm text-muted">填写后覆盖该集标题；留空时恢复源标题或补充资料。无需输入“第几集”。</p>
          <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={!autoDisabled} onChange={(event) => setAutoDisabled(!event.target.checked)} />自动查找缺失标题</label>
          <div className="max-h-[32rem] overflow-y-auto space-y-4 pr-2">
            {manual.map((value, index) => <label className="block text-sm" key={index}>
              第 {index + 1} 集<input className="input w-full mt-1" maxLength={300} value={value} placeholder={meaningfulEpisodeTitle(saved.detail.episodeTitles?.[index]) || '没有名称，可手动填写'} onChange={(event) => setManual((current) => current.map((title, i) => i === index ? event.target.value : title))} />
              <span className="block text-xs text-muted mt-1">显示：{formatEpisodeLabel(index, meaningfulEpisodeTitle(value) || fallbackTitle(index))}</span>
            </label>)}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button className="btn-primary" disabled={!dirty && !saved.stale} onClick={() => void run(async () => {
              apply(await request({ action: 'save', sourceKey: selected.sourceKey, vodId: selected.vodId, manualTitles: manual, autoDisabled, revision: saved.revision }));
              setMessage('已保存，客户端重新打开影片详情即可获取。');
            })}>保存分集资料</button>
            <button className="btn-ghost" onClick={() => apply(saved)}>撤销未保存改动</button>
            {dirty && <span className="text-warning text-sm">有未保存的改动，请先保存再导入资料。</span>}
          </div>
        </div>
      </>}
    </fieldset>
    {busy && <p role="status" className="text-sm text-muted">正在处理…</p>}
  </section>;
}
