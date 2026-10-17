'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AdminSourceManager } from './admin-source-manager';
import { AdminEpisodeManager } from './admin-episode-manager';
import { AdminRecommendationManager } from './admin-recommendation-manager';
import { AdminUserManager } from './admin-user-manager';

interface AdminStatus {
  configured: boolean;
  verified: boolean;
  sourceMode: 'client' | 'server';
  accountMode: boolean;
  accountConfigured: boolean;
}

export function AdminConsole() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [section, setSection] = useState<'sources' | 'episodes' | 'users' | 'recommendations'>('users');
  const sessionExpired = useCallback(() => setStatus((current) => current ? { ...current, verified: false } : current), []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/admin/auth', { cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new Error('后台状态读取失败');
      return res.json() as Promise<AdminStatus>;
    }).then((data) => { if (!cancelled) setStatus(data); })
      .catch(() => { if (!cancelled) setError('无法连接后台，请刷新重试。'); });
    return () => { cancelled = true; };
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '登录失败');
      setPassword('');
      setStatus((current) => current ? { ...current, verified: true } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败'); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/auth', { method: 'DELETE' });
      if (!res.ok) throw new Error('退出失败，请重试');
      setStatus((current) => current ? { ...current, verified: false } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '退出失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="max-w-5xl mx-auto px-5 py-5 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs text-accent font-medium tracking-widest">Luna12TV</p><h1 className="text-xl font-semibold">管理后台</h1></div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="btn-ghost">打开观看网页</Link>
            {status?.verified && <button className="btn-ghost" disabled={busy} onClick={() => void logout()}>退出后台</button>}
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-5 py-8">
        {!status && !error && <p className="text-muted">正在连接后台…</p>}
        {error && <p role="alert" className="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
        {status && !status.configured && <div className="card p-6 max-w-lg mx-auto"><h2 className="font-semibold">后台尚未配置</h2><p className="text-sm text-muted mt-2">请在服务器环境配置中设置 ADMIN_PASSWORD，然后重启服务。</p></div>}
        {status?.configured && !status.verified && <form onSubmit={(event) => void login(event)} className="card max-w-sm mx-auto p-6 space-y-5">
          <div><h2 className="text-lg font-semibold">管理员登录</h2><p className="text-sm text-muted mt-2">输入管理员密码，维护所有客户端共用的资源。</p></div>
          <label className="block text-sm">管理员密码<input autoFocus type="password" autoComplete="off" required maxLength={1024} className="input w-full mt-2" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button type="submit" className="btn-primary w-full" disabled={busy || !password}>{busy ? '登录中…' : '登录后台'}</button>
        </form>}
        {status?.verified && <>
          <nav className="flex flex-wrap gap-3 mb-7" aria-label="后台功能">
            <button className={section === 'users' ? 'btn-primary' : 'btn-ghost'} onClick={() => setSection('users')}>账号管理</button>
            <button className={section === 'sources' ? 'btn-primary' : 'btn-ghost'} onClick={() => setSection('sources')}>点播源</button>
            <button className={section === 'episodes' ? 'btn-primary' : 'btn-ghost'} onClick={() => setSection('episodes')}>分集资料</button>
            <button className={section === 'recommendations' ? 'btn-primary' : 'btn-ghost'} onClick={() => setSection('recommendations')}>首页推荐</button>
          </nav>
          {section === 'recommendations' ? <AdminRecommendationManager onSessionExpired={sessionExpired} /> : section === 'users' ? (status.accountMode && status.accountConfigured ? <AdminUserManager onSessionExpired={sessionExpired} /> : <div className="card p-6"><h2 className="font-semibold">账号模式尚未开启</h2><p className="mt-2 text-sm text-muted">在服务器配置 AUTH_MODE=account、BETTER_AUTH_URL 和 BETTER_AUTH_SECRET，然后重启服务。开启后可在此创建账号，不开放注册。</p></div>) : status.sourceMode !== 'server' ? <div className="card p-6"><h2 className="font-semibold">请开启服务器源管理模式</h2><p className="mt-2 text-sm text-muted">将服务器环境配置中的 SOURCE_MODE 设为 server，然后重启服务。</p></div> : section === 'sources' ? <AdminSourceManager onSessionExpired={sessionExpired} /> : <AdminEpisodeManager onSessionExpired={sessionExpired} />}
        </>}
      </main>
    </div>
  );
}
