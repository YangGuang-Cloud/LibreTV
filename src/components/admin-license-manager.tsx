'use client';
import { useCallback, useEffect, useState } from 'react';
type License = { id: string; label: string; days: number; redeemBefore: number; createdAt: number; revokedAt: number | null; username: string | null; userId: string | null; redeemedAt: number | null; grantedUntil: number | null; state: string; code?: string; access?: { state: string; expiresAt: number | null } };
const date = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const duration = (days: number) => days === 0 ? '无限期' : `${days} 天`;
const deadline = (value: number) => value === 0 ? '不限兑换时间' : date(value);
const states: Record<string, string> = { unused: '未使用', used: '已使用', revoked: '已作废', expired: '已失效' };
export function AdminLicenseManager({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [items, setItems] = useState<License[]>([]), [selected, setSelected] = useState<License | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({}), [offset, setOffset] = useState(0);
  const [count, setCount] = useState(1), [days, setDays] = useState(30), [label, setLabel] = useState('');
  const [redeemBefore, setRedeemBefore] = useState(() => new Date(Date.now() + 30 * 86400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  const [unlimited, setUnlimited] = useState(false), [customDays, setCustomDays] = useState(false);
  const [redeemMode, setRedeemMode] = useState('30');
  const [copyMessage, setCopyMessage] = useState('');
  const [generated, setGenerated] = useState<{ id: string; code: string }[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useCallback(async (url: string, options?: RequestInit) => {
    const res = await fetch(url, { cache: 'no-store', ...options });
    if (res.status === 401) { onSessionExpired(); throw new Error('请重新登录后台'); }
    const body = await res.json(); if (!res.ok) throw new Error(body.error || '读取失败'); return body;
  }, [onSessionExpired]);
  const load = useCallback(async () => { try { const body = await request(`/api/admin/licenses?offset=${offset}`); setItems(body.items); setTotals(body.totals); } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); } }, [offset, request]);
  useEffect(() => { void load(); }, [load]);
  const detail = async (id: string) => { setBusy(true); setError(''); try { setSelected(await request(`/api/admin/licenses?id=${encodeURIComponent(id)}`)); } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); } finally { setBusy(false); } };
  return <section className="space-y-5">
    <div className="flex gap-3 items-center">{selected && <button className="btn-ghost" onClick={() => setSelected(null)}>← 返回列表</button>}<h2 className="text-lg font-semibold">{selected ? '授权码详情' : '授权码管理'}</h2></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {selected ? <div className="card p-5 space-y-5">
      <label className="block text-sm">授权码<input className="input w-full mt-2 font-mono" readOnly value={selected.code || ''} /></label>
      <dl className="grid sm:grid-cols-2 gap-5 text-sm">{[
        ['编号', selected.id], ['状态', states[selected.state]], ['授权时长', duration(selected.days)], ['备注', selected.label || '—'], ['生成时间', date(selected.createdAt)], ['最晚兑换时间', deadline(selected.redeemBefore)], ['绑定账号', selected.username || '尚未绑定'], ['兑换时间', date(selected.redeemedAt)], ['本次授权截止', selected.redeemedAt && selected.days === 0 ? '无限期' : date(selected.grantedUntil)], ['账号当前授权截止', selected.access?.state === 'active' && selected.access.expiresAt === null ? '无限期' : date(selected.access?.expiresAt ?? null)], ['作废时间', date(selected.revokedAt)],
      ].map(([key, value]) => <div key={key}><dt className="text-muted">{key}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>
      {selected.state === 'unused' && <button className="btn-ghost text-danger" disabled={busy} onClick={async () => { setBusy(true); try { await request('/api/admin/licenses', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id }) }); await detail(selected.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } }}>作废此授权码</button>}
      <p className="text-xs text-muted">授权码首次兑换后永久绑定账号，不能重复兑换或转给其他账号。已使用的授权码保留记录；如需停用账号，请在账号管理操作。</p>
    </div> : <>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">{[['total', '已生成'], ['unused', '未使用'], ['used', '已使用'], ['expired', '已失效'], ['revoked', '已作废']].map(([key, title]) => <div key={key} className="card p-4"><p className="text-xs text-muted">{title}</p><p className="text-xl mt-2 text-accent">{totals[key] ?? '—'}</p></div>)}</div>
      <form className="card p-5 space-y-4" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { const body = await request('/api/admin/licenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count, days: unlimited ? null : days, redeemBefore: redeemMode === 'none' ? null : redeemMode === 'custom' ? new Date(redeemBefore).getTime() : Date.now() + Number(redeemMode) * 86400_000, label }) }); setGenerated(body.codes); setCopyMessage(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : '生成失败'); } finally { setBusy(false); } }}>
        <h3 className="font-medium">生成授权码</h3><div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm">数量<input type="number" min={1} max={100} required className="input w-full mt-2" value={count} onChange={e => setCount(Number(e.target.value))} /></label>
          <fieldset className="sm:col-span-2 space-y-3"><legend className="text-sm mb-2">授权类型</legend>
            <div className="flex gap-2">{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={unlimited === value} className={unlimited === value ? 'btn-primary' : 'btn-ghost'} onClick={() => setUnlimited(value)}>{value ? '无限期' : '限时授权'}</button>)}</div>
            {unlimited ? <p className="text-sm text-muted">兑换后长期有效，管理员仍可停用账号。</p> : <>
              <div className="flex flex-wrap gap-2">{[1, 7, 30, 90, 180, 365].map(value => <button key={value} type="button" aria-pressed={!customDays && days === value} className={!customDays && days === value ? 'btn-primary' : 'btn-ghost'} onClick={() => { setDays(value); setCustomDays(false); }}>{value} 天</button>)}<button type="button" aria-pressed={customDays} className={customDays ? 'btn-primary' : 'btn-ghost'} onClick={() => setCustomDays(true)}>自定义</button></div>
              {customDays && <label className="block text-sm">授权天数<input type="number" min={1} max={3650} required className="input w-full mt-2" value={days} onChange={e => setDays(Number(e.target.value))} /></label>}
              <p className="text-xs text-muted">首次激活从兑换时起算；未到期续期从原到期时间累加。</p>
            </>}
          </fieldset>
          <details className="sm:col-span-2"><summary className="cursor-pointer text-sm">更多设置 · 兑换期限</summary><div className="mt-3 space-y-3">
            <label className="block text-sm">兑换期限<select className="input w-full mt-2" value={redeemMode} onChange={e => setRedeemMode(e.target.value)}><option value="none">不限</option><option value="7">生成后 7 天内</option><option value="30">生成后 30 天内</option><option value="custom">自定义日期</option></select></label>
            {redeemMode === 'custom' && <label className="block text-sm">最晚兑换时间<input type="datetime-local" required className="input w-full mt-2" value={redeemBefore} onChange={e => setRedeemBefore(e.target.value)} /></label>}
            <p className="text-xs text-muted">此设置只限制授权码何时可兑换，不影响兑换后的使用时长。</p>
          </div></details>
          <label className="text-sm">备注<input maxLength={100} className="input w-full mt-2" value={label} onChange={e => setLabel(e.target.value)} /></label>
        </div><p className="text-sm text-muted">将生成 {count} 个授权码，{unlimited ? '兑换后无限期使用' : `每个可使用 ${days} 天`}，{redeemMode === 'none' ? '不限兑换时间' : redeemMode === 'custom' ? `需在 ${redeemBefore.replace('T', ' ')} 前兑换` : `需在生成后 ${redeemMode} 天内兑换`}。</p><button className="btn-primary" disabled={busy}>{busy ? '正在处理…' : '生成授权码'}</button>
        {generated.length > 0 && <div className="space-y-2"><p role="status" className="text-sm">已生成 {generated.length} 个授权码</p><button type="button" className="btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(generated.map(item => item.code).join('\n')); setCopyMessage('已复制全部授权码'); } catch { setCopyMessage('复制失败，请选中下方授权码手动复制'); } }}>复制全部</button>{copyMessage && <p role="status" className="text-xs text-muted">{copyMessage}</p>}<label className="block text-sm">本次生成（可选中复制）<textarea readOnly rows={Math.min(8, generated.length + 1)} className="input w-full mt-2 font-mono text-xs" value={generated.map(item => item.code).join('\n')} /></label></div>}
      </form>
      <div className="card p-5 space-y-4"><div className="flex justify-between"><h3 className="font-medium">全部授权码</h3><button className="btn-ghost text-sm" onClick={() => void load()}>刷新</button></div>
        <div className="max-h-[65vh] overflow-y-auto space-y-2">{items.map(item => <button key={item.id} disabled={busy} className="w-full text-left rounded-xl border border-line p-4 flex gap-3 items-center hover:bg-chip" onClick={() => void detail(item.id)}><span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.label || '授权码'} · {duration(item.days)}</span><span className="block text-xs text-muted mt-1">编号 {item.id.slice(0, 8)} · {item.username ? `绑定 ${item.username}` : `最晚兑换 ${deadline(item.redeemBefore)}`}</span></span><span className="text-sm text-accent">{states[item.state]} ›</span></button>)}{items.length === 0 && <p className="text-sm text-muted py-6 text-center">暂无授权码</p>}</div>
        {(totals.total || 0) > 50 && <div className="flex items-center gap-4"><button className="btn-ghost" disabled={offset === 0} onClick={() => setOffset(offset - 50)}>上一页</button><span className="text-sm">第 {offset / 50 + 1} 页</span><button className="btn-ghost" disabled={offset + 50 >= totals.total} onClick={() => setOffset(offset + 50)}>下一页</button></div>}
      </div>
    </>}
  </section>;
}
