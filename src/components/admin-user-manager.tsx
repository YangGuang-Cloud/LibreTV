'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ConfirmDialog } from './confirm-dialog';

interface User { id: string; username: string; name: string; banned: number; passwordAvailable: boolean; }

export function AdminUserManager({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
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
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); return false; }
    finally { setBusy(false); }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (await mutate('POST', { username, name: name || username, password }, `账号 ${username} 已创建，请将账号与密码私下告知使用者。`)) {
      setUsername(''); setName(''); setPassword('');
    }
  };

  return <section className="space-y-6">
    <div><h2 className="text-lg font-semibold">账号管理</h2><p className="mt-2 text-sm text-muted">仅管理员可创建账号，本站不开放注册。停用或重置密码会立即退出该账号的所有设备。新建或重新设置后的密码支持管理员查看。</p></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {message && <p role="status" className="text-sm text-accent">{message}</p>}
    <form onSubmit={(event) => void create(event)} className="card p-5 space-y-4">
      <h3 className="font-medium">添加账号</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">账号<input required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="off" className="input w-full mt-2" placeholder="字母、数字或下划线" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label className="text-sm">显示名称<input maxLength={80} className="input w-full mt-2" placeholder="选填，默认使用账号" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="text-sm">初始密码<input required type="password" minLength={6} maxLength={128} autoComplete="new-password" className="input w-full mt-2" placeholder="至少 6 位" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      </div>
      <button className="btn-primary" disabled={busy}>{busy ? '正在处理…' : '创建账号'}</button>
    </form>
    <div className="card p-5 space-y-4">
      <h3 className="font-medium">已有账号（{total}）</h3>
      {loading ? <p className="text-muted text-sm">正在读取…</p> : users.length === 0 ? <p className="text-muted text-sm">还没有账号，添加后即可在观看网页登录。</p> : users.map((user) => <div key={user.id} className="flex flex-wrap items-center gap-3 border-b border-line pb-4 last:border-0">
        <div className="flex-1 min-w-32"><p className="font-medium">{user.name}</p><p className="text-sm text-muted">{user.username} · {user.banned ? '已停用' : '正常'}</p></div>
        {user.passwordAvailable ? <button className="btn-ghost text-sm" disabled={busy || revealingId === user.id} onClick={() => shownPassword?.userId === user.id ? hidePassword() : void reveal(user)}>{revealingId === user.id ? '读取中…' : shownPassword?.userId === user.id ? '隐藏密码' : '查看密码'}</button> : <span className="text-xs text-muted">需重置后才能查看密码</span>}
        <button className="btn-ghost text-sm" disabled={busy} onClick={() => { hidePassword(); setResetUser(user); setResetPassword(''); }}>重置密码</button>
        <button className="btn-ghost text-sm" disabled={busy} onClick={() => user.banned ? void mutate('PATCH', { userId: user.id, action: 'enable' }, '账号已启用') : setDisableUser(user)}>{user.banned ? '启用账号' : '停用账号'}</button>
        {shownPassword?.userId === user.id && <div className="w-full rounded-lg bg-chip p-3 space-y-2">
          <label className="block text-sm">{user.username} 的密码<input className="input w-full mt-2" type="text" readOnly autoComplete="off" value={shownPassword.password} /></label>
          <p className="text-xs text-muted">30 秒后自动隐藏，离开此窗口也会隐藏。</p>
        </div>}
      </div>)}
      {total > 50 && <div className="flex items-center gap-4"><button className="btn-ghost" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><span className="text-sm text-muted">第 {offset / 50 + 1} 页</span><button className="btn-ghost" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>下一页</button></div>}
    </div>
    <ConfirmDialog open={!!disableUser} title={`停用账号 ${disableUser?.username || ''}？`} message="该账号将立即退出所有设备，无法再次登录。已有数据会保留，之后可重新启用。" confirmLabel="停用账号" danger onCancel={() => setDisableUser(null)} onConfirm={() => { const user = disableUser; setDisableUser(null); if (user) void mutate('PATCH', { userId: user.id, action: 'disable' }, '账号已停用'); }} />
    {resetUser && <form className="card p-5 space-y-4" onSubmit={(event) => { event.preventDefault(); void mutate('PATCH', { userId: resetUser.id, action: 'reset-password', password: resetPassword }, '密码已重置，所有设备已退出登录').then((ok) => { if (ok) { setResetUser(null); setResetPassword(''); } }); }}>
      <h3 className="font-medium">重置 {resetUser.username} 的密码</h3>
      <label className="block text-sm">新密码<input autoFocus required type="password" minLength={6} maxLength={128} autoComplete="new-password" className="input w-full mt-2" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
      <div className="flex gap-3"><button className="btn-primary" disabled={busy}>确认重置</button><button type="button" className="btn-ghost" disabled={busy} onClick={() => { setResetUser(null); setResetPassword(''); }}>取消</button></div>
    </form>}
  </section>;
}
