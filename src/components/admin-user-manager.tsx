'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './confirm-dialog';
import { AdminAccountDetailView } from './admin-account-detail';

interface User { id: string; username: string; name: string; banned: number; passwordAvailable: boolean; access?: { state: string; expiresAt: number | null }; }

export function AdminUserManager({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [disableUser, setDisableUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [shownPassword, setShownPassword] = useState<{ userId: string; password: string } | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const revealRequest = useRef<AbortController | null>(null);
  const revealGeneration = useRef(0);
  const hidePassword = useCallback(() => {
    revealGeneration.current += 1;
    revealRequest.current?.abort(); revealRequest.current = null;
    setShownPassword(null); setRevealingId(null);
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.hidden) hidePassword(); };
    window.addEventListener('blur', hidePassword);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      revealGeneration.current += 1; revealRequest.current?.abort();
      window.removeEventListener('blur', hidePassword); document.removeEventListener('visibilitychange', hidden);
    };
  }, [hidePassword]);
  useEffect(() => {
    if (!shownPassword) return;
    const timer = setTimeout(hidePassword, 30_000);
    return () => clearTimeout(timer);
  }, [shownPassword, hidePassword]);
  const reveal = async (user: User) => {
    hidePassword(); setError('');
    const generation = revealGeneration.current;
    const controller = new AbortController(); revealRequest.current = controller;
    setRevealingId(user.id);
    try {
      const response = await fetch('/api/admin/users/password', { method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id }) });
      if (controller.signal.aborted || generation !== revealGeneration.current) return;
      if (response.status === 401) { onSessionExpired(); return; }
      const data = await response.json();
      if (controller.signal.aborted || generation !== revealGeneration.current) return;
      if (!response.ok) throw new Error(data.error || '密码读取失败');
      setShownPassword({ userId: user.id, password: data.password });
    } catch (cause) { if (!controller.signal.aborted && generation === revealGeneration.current) setError(cause instanceof Error ? cause.message : '密码读取失败'); }
    finally { if (generation === revealGeneration.current) setRevealingId(null); }
  };

  const load = useCallback(async () => {
    hidePassword();
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users?offset=${offset}`, { cache: 'no-store' });
      if (response.status === 401) onSessionExpired();
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '账号读取失败');
      setUsers(body.users); setTotal(body.total);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '账号读取失败'); }
    finally { setLoading(false); }
  }, [offset, onSessionExpired, hidePassword]);
  useEffect(() => { void load(); }, [load]);

  const mutate = async (method: string, body: Record<string, unknown>, success: string) => {
    hidePassword();
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/users', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (response.status === 401) onSessionExpired();
      if (!response.ok) throw new Error(data.error || '操作失败');
      setMessage(success);
      await load();
      setDetailRevision((value) => value + 1);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); return false; }
    finally { setBusy(false); }
  };
  const currentUser = selectedUser ? users.find((user) => user.id === selectedUser.id) || selectedUser : null;
  const closeDetail = () => { hidePassword(); setResetUser(null); setResetPassword(''); setDisableUser(null); setSelectedUser(null); setError(''); setMessage(''); };
  const accountActions = currentUser && <div className="space-y-3 border-t border-line pt-4">
    <div className="text-sm space-y-1"><p>账号授权：{currentUser.access?.state === 'active' ? '使用中' : currentUser.access?.state === 'expired' ? '已到期' : '待激活'}</p><p className="text-muted">到期时间：{currentUser.access?.expiresAt ? new Date(currentUser.access.expiresAt).toLocaleString('zh-CN') : '尚未激活'}</p></div>
    <div className="flex flex-wrap gap-2">
      {currentUser.passwordAvailable ? <button className="btn-ghost text-sm" disabled={busy || revealingId === currentUser.id} onClick={() => shownPassword?.userId === currentUser.id ? hidePassword() : void reveal(currentUser)}>{revealingId === currentUser.id ? '读取中…' : shownPassword?.userId === currentUser.id ? '隐藏密码' : '查看密码'}</button> : <span className="text-xs text-muted self-center">需重置后才能查看密码</span>}
      <button className="btn-ghost text-sm" disabled={busy} onClick={() => { hidePassword(); setResetUser(currentUser); setResetPassword(''); }}>重置密码</button>
      <button className="btn-ghost text-sm" disabled={busy} onClick={() => currentUser.banned ? void mutate('PATCH', { userId: currentUser.id, action: 'enable' }, '账号已启用') : setDisableUser(currentUser)}>{currentUser.banned ? '启用账号' : '停用账号'}</button>
    </div>
    {shownPassword?.userId === currentUser.id && <div className="rounded-lg bg-chip p-3 space-y-2">
      <label className="block text-sm">{currentUser.username} 的密码<input className="input w-full mt-2" type="text" readOnly autoComplete="off" value={shownPassword.password} /></label>
      <p className="text-xs text-muted">30 秒后自动隐藏，离开此窗口也会隐藏。</p>
    </div>}
    {resetUser && <form className="rounded-lg bg-chip p-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void mutate('PATCH', { userId: resetUser.id, action: 'reset-password', password: resetPassword }, '密码已重置，所有设备已退出登录').then((ok) => { if (ok) { setResetUser(null); setResetPassword(''); } }); }}>
      <h3 className="font-medium">重置 {resetUser.username} 的密码</h3>
      <label className="block text-sm">新密码<input autoFocus required type="password" minLength={6} maxLength={128} autoComplete="new-password" className="input w-full mt-2" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
      <div className="flex gap-3"><button className="btn-primary" disabled={busy}>确认重置</button><button type="button" className="btn-ghost" disabled={busy} onClick={() => { setResetUser(null); setResetPassword(''); }}>取消</button></div>
    </form>}
  </div>;

  return <section className="space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      {selectedUser && <button className="btn-ghost" onClick={closeDetail} disabled={busy}>← 返回账号列表</button>}
      <h2 className="text-lg font-semibold">{selectedUser ? '账号详情' : '账号管理'}</h2>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {message && <p role="status" className="text-sm text-accent">{message}</p>}
    <div hidden={!!selectedUser} className="space-y-5">
      <p className="text-sm text-muted">请在「授权码管理」生成授权码，用户凭码自行注册账号和设置密码。</p>
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3"><h3 className="font-medium">全部账号（{total}）</h3><button className="btn-ghost text-sm" disabled={loading} onClick={() => void load()}>刷新</button></div>
        {loading && users.length === 0 ? <p className="text-muted text-sm py-8 text-center">正在读取…</p> : users.length === 0 ? <p className="text-muted text-sm py-8 text-center">暂无账号</p> : <div className="max-h-[65vh] overflow-y-auto overscroll-contain space-y-2 pr-1" aria-label="账号列表" tabIndex={0}>
          {users.map((user) => <button key={user.id} className="w-full flex items-center gap-4 rounded-xl border border-line p-4 text-left hover:bg-chip transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { hidePassword(); setError(''); setMessage(''); setSelectedUser(user); }}>
            <span className="flex-1 min-w-0"><span className="block font-medium truncate">{user.name}</span><span className="block text-sm text-muted truncate mt-1">{user.username}</span></span>
            <span className={`rounded-full px-2.5 py-1 text-xs ${user.banned ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>{user.banned ? '已停用' : user.access?.state === 'active' ? '使用中' : user.access?.state === 'expired' ? '已到期' : '待激活'}</span>
            <span className="text-sm text-muted">详情 ›</span>
          </button>)}
        </div>}
        {total > 50 && <div className="flex flex-wrap items-center gap-4"><button className="btn-ghost" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><span className="text-sm text-muted">第 {offset / 50 + 1} 页</span><button className="btn-ghost" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>下一页</button></div>}
      </div>
    </div>
    {selectedUser && <AdminAccountDetailView key={selectedUser.id} userId={selectedUser.id} revision={detailRevision} onSessionExpired={onSessionExpired} actions={accountActions} />}
    <ConfirmDialog open={!!disableUser} title={`停用账号 ${disableUser?.username || ''}？`} message="该账号将立即退出所有设备，无法再次登录。已有数据会保留，之后可重新启用。" confirmLabel="停用账号" danger onCancel={() => setDisableUser(null)} onConfirm={() => { const user = disableUser; setDisableUser(null); if (user) void mutate('PATCH', { userId: user.id, action: 'disable' }, '账号已停用'); }} />
  </section>;
}
