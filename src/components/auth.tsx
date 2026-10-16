'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';
import type { AuthStatusResponse } from '@/lib/types';
import { useToast } from './toast';
import { stopAccountData, waitForAccountWrites } from '@/lib/account-data';

/**
 * 认证上下文：
 * - 页面加载时查询 /api/status 判断会话有效性；
 * - 任何 API 返回 401 时全局打开登录框（客户端 API 层统一触发，不再散落检查）。
 */

type SetupRequired = boolean;
const ACCOUNT_CHANGE_KEY = 'libretv-account-change';
function notifyAccountChange() {
  try { localStorage.setItem(ACCOUNT_CHANGE_KEY, crypto.randomUUID()); } catch { /* 不可用时由定时会话检查补齐 */ }
}

interface AuthContextValue {
  checked: boolean;
  verified: boolean;
  /** 服务器未设置 PASSWORD，需要管理员配置 */
  setupRequired: SetupRequired;
  /** /api/status 返回的应用版本（构建时从 package.json 注入） */
  version: string | null;
  accountMode: boolean;
  user: AuthStatusResponse['user'];
  openLogin: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  checked: false,
  verified: false,
  setupRequired: false,
  version: null,
  accountMode: false,
  user: null,
  openLogin: () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children, initialStatus }: { children: ReactNode; initialStatus?: AuthStatusResponse }) {
  const [checked, setChecked] = useState(!!initialStatus);
  const [verified, setVerified] = useState(initialStatus?.verified ?? false);
  const [setupRequired, setSetupRequired] = useState(initialStatus ? !initialStatus.passwordRequired : false);
  const [version, setVersion] = useState<string | null>(initialStatus?.version ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [accountMode, setAccountMode] = useState(initialStatus?.authMode === 'account');
  const [user, setUser] = useState<AuthStatusResponse['user']>(initialStatus?.user ?? null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!accountMode) return;
    const changed = (event: StorageEvent) => { if (event.key === ACCOUNT_CHANGE_KEY) window.location.reload(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [accountMode]);

  // 登录后及每分钟同步源配置；管理员保存后其他网页无需重新登录。
  useEffect(() => {
    if (!verified) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await queryClient.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status(), staleTime: 0 });
        if (cancelled) return;
        if (status.authMode === 'account' && status.user?.id !== user?.id) { window.location.reload(); return; }
        if (!status.verified) { setVerified(false); return; }
        await applyEnvPresets(status);
      } catch { /* 短暂离线时保留已有配置 */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [verified, queryClient, user?.id]);

  // 与 Providers 共用同一 query key 与缓存，避免 /api/status 被请求两次
  useEffect(() => {
    let cancelled = false;
    queryClient
      .fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() })
      .then((s) => {
        if (cancelled) return;
        setVerified(s.verified);
        setAccountMode(s.authMode === 'account');
        setUser(s.user);
        setSetupRequired(!s.passwordRequired);
        setVersion(s.version);
        setChecked(true);
        void applyEnvPresets(s);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  useEffect(
    () =>
      onUnauthorized((event) => {
        const setup = (event as CustomEvent).detail === 'setup';
        setSetupRequired(setup);
        setVerified(false);
        setModalOpen(true);
      }),
    []
  );

  const openLogin = useCallback(() => setModalOpen(true), []);

  const logout = useCallback(async () => {
    try {
      if (accountMode) await waitForAccountWrites();
      await api.logout();
      if (accountMode) { stopAccountData(); notifyAccountChange(); window.location.reload(); return; }
      setVerified(false);
      toast('已退出登录', 'info');
    } catch {
      toast('退出失败，请检查网络后重试', 'error');
    }
  }, [toast, accountMode]);

  const handleLoginSuccess = useCallback(async () => {
    if (accountMode) { notifyAccountChange(); window.location.reload(); return; }
    setVerified(true);
    setSetupRequired(false);
    setModalOpen(false);
    // 登录前以 401 失败的查询（如豆瓣推荐）需要重新拉取
    queryClient.invalidateQueries();
    toast('验证成功', 'success');
    // 登录前状态不包含源配置，必须重新请求，不能复用匿名状态缓存。
    try {
      const status = await queryClient.fetchQuery<AuthStatusResponse>({
          queryKey: STATUS_QUERY_KEY,
          queryFn: () => api.status(),
          staleTime: 0,
        });
      if (status) await applyEnvPresets(status);
    } catch {
      // 补拉预置数据失败不影响登录后的正常使用
    }
  }, [toast, queryClient, accountMode]);

  return (
    <AuthContext.Provider value={{ checked, verified, setupRequired, version, accountMode, user, openLogin, logout }}>
      {accountMode && !verified ? <main className="min-h-screen flex items-center justify-center p-6"><div className="card p-8 text-center space-y-4"><h1 className="text-xl font-semibold">Luna12TV · 月十二影视</h1><p className="text-sm text-muted">请使用管理员分配的账号登录。</p><button className="btn-primary" onClick={openLogin}>账号登录</button></div></main> : children}
      {(modalOpen || (checked && accountMode && !verified)) && (
        <LoginModal
          accountMode={accountMode}
          setupRequired={setupRequired}
          onSuccess={handleLoginSuccess}
          onClose={() => setModalOpen(false)}
        />
      )}
    </AuthContext.Provider>
  );
}

function LoginModal({
  accountMode,
  setupRequired,
  onSuccess,
  onClose,
}: {
  accountMode: boolean;
  setupRequired: boolean;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!accountMode) inputRef.current?.focus();
  }, [accountMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const submit = async () => {
    if (!password.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      await api.login(password, accountMode ? username.trim() : undefined);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '验证失败';
      setError(msg === '需要登录' ? '密码错误' : msg);
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-surface-raised rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={setupRequired ? '需要配置登录方式' : accountMode ? '账号登录' : '访问验证'}
      >
        {setupRequired ? (
          <>
            <h2 className="text-lg font-semibold text-content mb-3">需要配置密码</h2>
            <p className="text-sm text-muted leading-relaxed">
              登录方式尚未配置完成，请联系管理员检查服务器配置并重启服务。
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-content mb-1">{accountMode ? '账号登录' : '访问验证'}</h2>
            <p className="text-sm text-muted mb-4">{accountMode ? '使用管理员提供的账号与密码，不开放注册。' : '请输入密码继续访问'}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {accountMode && <label className="block text-sm mb-3">账号<input autoFocus required autoComplete="username" maxLength={32} className="input w-full mt-2" value={username} onChange={(event) => setUsername(event.target.value)} /></label>}
              <label className="block text-sm">密码
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                placeholder="密码"
                autoComplete="current-password"
                required
                maxLength={accountMode ? 128 : undefined}
              />
              </label>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
              <button type="submit" className="btn-primary w-full mt-4" disabled={loading || !password.trim() || (accountMode && !username.trim())}>
                {loading ? '验证中...' : '进入'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
