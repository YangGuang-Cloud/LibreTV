'use client';
import { useEffect, useRef } from 'react';

export interface AdminIdentity { username: string; name: string; }
export function AdminAccountMenu({ user, remember, expiresAt, busy, onLogout }: {
  user: AdminIdentity; remember: boolean; expiresAt: number | null; busy: boolean; onLogout: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target) && menu.current) menu.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  return <details ref={menu} className="relative shrink-0">
    <summary className="btn-ghost text-sm cursor-pointer flex items-center gap-2 max-w-44" aria-label={`管理员账号：${user.username}`}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-accent shrink-0"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" /></svg>
      <span className="truncate">{user.username}</span><span aria-hidden="true" className="text-muted text-xs">⌄</span>
    </summary>
    <div className="absolute right-0 mt-2 w-64 max-w-[85vw] card p-4 shadow-xl space-y-3 z-50">
      <div><p className="text-xs text-muted">当前登录 · {user.name}</p><p className="mt-1 font-semibold break-all">{user.username}</p></div>
      <p className="text-xs text-muted leading-relaxed">{remember ? '已保持登录，再次打开可直接进入。' : '本次会话有效，最长 8 小时。'}{expiresAt && <span className="block mt-1">有效至 {new Date(expiresAt).toLocaleString('zh-CN', { hour12: false })}</span>}</p>
      <button className="btn-ghost w-full text-sm" disabled={busy} onClick={onLogout}>{busy ? '退出中…' : '退出账号'}</button>
    </div>
  </details>;
}
