'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ToastProvider } from './toast';
import { AuthProvider } from './auth';
import { ThemeProvider } from './theme';
import { GlobalDownloadManager } from './download-manager';
import { useAppStore, hydrateLiveProbeResults } from '@/lib/store';
import { api, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';
import { usePathname } from 'next/navigation';
import { setClientDataScope, clearObsoletePersonalStorage } from '@/lib/db';
import type { AuthStatusResponse } from '@/lib/types';
import { startAccountData, stopAccountData } from '@/lib/account-data';
import { AccountDataNotice } from './account-data-notice';

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return <ThemeProvider><ToastProvider>{children}</ToastProvider></ThemeProvider>;
  }
  return <ViewerProviders>{children}</ViewerProviders>;
}

function ViewerProviders({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [initialError, setInitialError] = useState(false);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
        },
      })
  );

  // 身份与个人数据就绪后再挂载页面，避免闪现其他账号或旧缓存。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先确定账号，再从服务器读取个人数据。
      const status = await queryClient.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() });
      if (cancelled) return;
      setClientDataScope(status.user?.id || null, status.authMode === 'account');
      useAppStore.setState(useAppStore.getInitialState(), true);
      await clearObsoletePersonalStorage().catch(() => {});
      if (cancelled) return;
      if (status.authMode === 'account' && status.user) {
        await startAccountData(status.user.id, () => {
          void queryClient.invalidateQueries({ queryKey: ['searchHistory'] });
          void queryClient.invalidateQueries({ queryKey: ['viewingHistory'] });
        });
      }
      if (cancelled) return;
      void hydrateLiveProbeResults();
      if (!cancelled) setReady(true);
      await applyEnvPresets(status);
    })().catch(() => { if (!cancelled) setInitialError(true); });
    return () => { cancelled = true; stopAccountData(); };
  }, [queryClient]);

  if (!ready) return <main className="min-h-screen flex items-center justify-center p-6"><div className="text-center space-y-4"><p className="text-muted">{initialError ? '无法连接服务，请检查网络后重试。' : '正在连接服务…'}</p>{initialError && <button className="btn-primary" onClick={() => window.location.reload()}>重新连接</button>}</div></main>;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          {/* 全站常驻：下载事件监听（enqueueDownload）依赖它存在——
              挂在 Header 里会让 /watch 等不渲染 Header 的页面派发的事件凭空丢失 */}
          <GlobalDownloadManager />
          <AccountDataNotice />
          <AuthProvider initialStatus={queryClient.getQueryData<AuthStatusResponse>(STATUS_QUERY_KEY)}>{children}</AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
