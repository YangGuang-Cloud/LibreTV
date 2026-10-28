'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminEpisodeManager } from './admin-episode-manager';
import { AdminSourceManager } from './admin-source-manager';
import { AdminRecommendationManager } from './admin-recommendation-manager';
interface Profile { id:string; name:string; accounts:number; }
export function AdminContentProfiles({onSessionExpired}:{onSessionExpired:()=>void}){
  const router=useRouter(),params=useSearchParams(),id=params.get('profile'),part=params.get('part')==='home'?'home':params.get('part')==='episodes'?'episodes':'sources';
  const [profiles,setProfiles]=useState<Profile[]>([]),[name,setName]=useState(''),[copy,setCopy]=useState('default');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useCallback(async(path:string,body?:unknown)=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});if(r.status===401)onSessionExpired();const value=await r.json();if(!r.ok)throw new Error(value.error||'内容方案操作失败');return value;},[onSessionExpired]);
  const load=useCallback(async()=>{try{setProfiles((await request('/api/admin/content-profiles')).profiles);}catch(e){setError(e instanceof Error?e.message:'读取失败');}},[request]);
  useEffect(()=>{void load();},[load]);
  const selected=profiles.find(profile=>profile.id===id);
  const navigate=(profile:string,section='sources')=>router.push(`/admin?tab=content&profile=${encodeURIComponent(profile)}&part=${section}`);
  return <section className="space-y-5">
    <div className="flex flex-wrap gap-3 items-center">{id&&<button className="btn-ghost" onClick={()=>router.push('/admin?tab=content')}>← 返回方案列表</button>}<h2 className="text-lg font-semibold">{selected?`内容方案 · ${selected.name}`:'内容方案'}</h2></div>
    {error&&<p role="alert" className="text-sm text-danger">{error}</p>}
    {!id?<>
      <p className="text-sm text-muted">每个账号使用一套方案，包含独立的首页推荐和搜索／点播源。修改方案后，已分配的网页和 iOS 客户端会自动获取更新。</p>
      <form className="card p-5 space-y-4" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const next=await request('/api/admin/content-profiles',{action:'create',name,copyFrom:copy});setName('');await load();navigate(next.id);}catch(e){setError(e instanceof Error?e.message:'创建失败');}finally{setBusy(false);}}}><h3 className="font-medium">创建内容方案</h3><div className="grid sm:grid-cols-2 gap-4"><label className="text-sm">方案名称<input required maxLength={50} className="input w-full mt-2" value={name} onChange={e=>setName(e.target.value)}/></label><label className="text-sm">复制已有方案<select className="input w-full mt-2" value={copy} onChange={e=>setCopy(e.target.value)}>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label></div><button className="btn-primary" disabled={busy}>创建方案</button></form>
      <div className="grid sm:grid-cols-2 gap-4">{profiles.map(profile=><button key={profile.id} className="card p-5 text-left hover:bg-chip" onClick={()=>navigate(profile.id)}><span className="block font-semibold">{profile.name}</span><span className="block text-sm text-muted mt-2">{profile.accounts} 个账号 · 查看并编辑 ›</span></button>)}</div>
    </>:selected?<>
      <p className="text-sm text-muted">当前有 {selected.accounts} 个账号使用此方案。账号使用的方案请在「账号管理」的账号卡片中选择。</p>
      {id!=='default'&&<form className="flex flex-wrap gap-3 items-end" onSubmit={async e=>{e.preventDefault();const input=new FormData(e.currentTarget).get('name');setBusy(true);try{await request('/api/admin/content-profiles',{action:'rename',profileId:id,name:input});await load();}catch(e){setError(e instanceof Error?e.message:'修改失败');}finally{setBusy(false);}}}><label className="text-sm">方案名称<input key={selected.name} name="name" required maxLength={50} className="input block mt-2" defaultValue={selected.name}/></label><button className="btn-ghost" disabled={busy}>修改名称</button></form>}
      <div className="flex flex-wrap gap-2" aria-label="内容方案配置">{[['sources','搜索／点播源'],['home','首页推荐'],['episodes','分集资料']].map(([key,title])=><button key={key} className={part===key?'btn-primary':'btn-ghost'} onClick={()=>navigate(id,key)}>{title}</button>)}</div>
      {part==='home'?<AdminRecommendationManager key={id} onSessionExpired={onSessionExpired} endpoint={`/api/admin/recommendations?profileId=${id}`} navigationBase={`/admin?tab=content&profile=${id}&part=home`}/>:part==='episodes'?<AdminEpisodeManager key={id} profileId={id} onSessionExpired={onSessionExpired}/>:<AdminSourceManager key={id} onSessionExpired={onSessionExpired} endpoint={`/api/admin/sources?profileId=${id}`}/>}
    </>:<p className="text-muted text-sm">{profiles.length ? '内容方案不存在，请返回方案列表。' : '正在读取方案…'}</p>}
  </section>;
}
