'use client';

import { useState } from 'react';
import { useAuth } from './auth';
import { refreshAccountData, useAccountDataStatus } from '@/lib/account-data';

export function AccountMenu() {
  const { accountMode, user, logout } = useAuth();
  const [editing, setEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const data = useAccountDataStatus();
  if (!accountMode || !user) return null;
  return <details className="relative shrink-0">
    <summary className="btn-ghost text-sm cursor-pointer max-w-28 truncate" aria-label={`账号：${user.name}`} title={user.name}><span className="sm:hidden">账号</span><span className="hidden sm:inline">{user.name}</span></summary>
    <div className="absolute right-0 mt-2 w-72 max-w-[90vw] card p-4 shadow-xl space-y-3 z-50">
      <p className="text-sm text-muted">账号：{user.username}</p>
      <p className="text-xs text-muted" role="status">{data.state === 'error' ? '暂时无法同步，已有内容可继续使用' : '个人数据与账号同步'}</p>
      <button className="btn-ghost w-full text-sm" onClick={() => void refreshAccountData(true)}>刷新账号数据</button>
      <button className="btn-ghost w-full text-sm" onClick={() => { setEditing(!editing); setMessage(''); setCurrentPassword(''); setNewPassword(''); }}>修改密码</button>
      {editing && <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault(); setBusy(true); setMessage('');
        void fetch('/api/auth/change-password', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
        }).then((res) => {
          if (!res.ok) throw new Error(res.status === 429 ? '操作频繁，请稍后再试' : '修改失败，请检查原密码或重新登录');
          setCurrentPassword(''); setNewPassword(''); setEditing(false); setMessage('密码已修改，其他设备已退出登录');
        }).catch((error) => setMessage(error instanceof Error ? error.message : '修改失败')).finally(() => setBusy(false));
      }}>
        <label className="block text-sm">原密码<input type="password" required maxLength={128} autoComplete="current-password" className="input w-full mt-1" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label className="block text-sm">新密码<input type="password" required minLength={6} maxLength={128} autoComplete="new-password" className="input w-full mt-1" placeholder="至少 6 位" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}</button>
      </form>}
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
      <button className="btn-ghost w-full text-sm" onClick={() => void logout()}>退出账号</button>
    </div>
  </details>;
}
