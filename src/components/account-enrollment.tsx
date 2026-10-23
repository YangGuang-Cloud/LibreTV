'use client';
import { useState } from 'react';
import { api } from '@/lib/client-api';
export function AccountEnrollment({ onSuccess, initialMode = 'login', initialUsername = '' }: { onSuccess: () => void; initialMode?: 'login' | 'register' | 'redeem'; initialUsername?: string }) {
  const [mode, setMode] = useState(initialMode), [username, setUsername] = useState(initialUsername), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="space-y-4">
    <div className="flex gap-2 flex-wrap">{([['login', '登录'], ['register', '注册'], ['redeem', '激活 / 续期']] as const).map(([key, title]) => <button key={key} type="button" className={mode === key ? 'btn-primary text-sm' : 'btn-ghost text-sm'} disabled={busy} onClick={() => { setMode(key); setError(''); }}>{title}</button>)}</div>
    <p className="text-sm text-muted">{mode === 'register' ? '凭管理员提供的授权码注册，账号与密码由你设置。' : mode === 'redeem' ? '输入账号、新授权码即可激活或续期，原有数据会保留。' : '登录账号继续观看。尚无账号可凭授权码注册。'}</p>
    <form className="space-y-3" onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError('');
      try {
        if (mode === 'register' && password !== confirmation) throw new Error('两次输入的密码不一致');
        if (mode !== 'login') {
          const response = await fetch(`/api/account/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password, code: code.trim() }) });
          const body = await response.json(); if (!response.ok) throw new Error(body.error || '操作失败');
        }
        if (mode !== 'redeem') await api.login(password, username.trim());
        setPassword(''); setConfirmation(''); setCode(''); onSuccess();
      } catch (cause) { const message = cause instanceof Error ? cause.message : '操作失败'; setError(message); if (mode === 'login' && (message.includes('授权') || message.includes('激活'))) setMode('redeem'); }
      finally { setBusy(false); }
    }}>
      <label className="block text-sm">账号<input required maxLength={32} minLength={3} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" className="input w-full mt-1" value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label className="block text-sm">密码<input required type="password" minLength={mode === 'register' ? 6 : undefined} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className="input w-full mt-1" value={password} onChange={e => setPassword(e.target.value)} /></label>
      {mode === 'register' && <label className="block text-sm">确认密码<input required type="password" maxLength={128} autoComplete="new-password" className="input w-full mt-1" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
      {mode !== 'login' && <label className="block text-sm">授权码<input required maxLength={150} autoComplete="off" className="input w-full mt-1" value={code} onChange={e => setCode(e.target.value)} /></label>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? '正在处理…' : mode === 'register' ? '注册并登录' : mode === 'redeem' ? '激活并进入' : '登录'}</button>
    </form>
  </div>;
}
