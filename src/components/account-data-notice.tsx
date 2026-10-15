'use client';
import { dismissAccountDataError, useAccountDataStatus } from '@/lib/account-data';

export function AccountDataNotice() {
  const status = useAccountDataStatus();
  if (!status.message) return null;
  return <div role="alert" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[110] w-[calc(100%-2rem)] max-w-lg rounded-xl border border-danger/40 bg-surface-raised p-4 shadow-xl flex items-center gap-3">
    <p className="text-sm flex-1">{status.message}</p><button className="btn-ghost text-sm shrink-0" onClick={dismissAccountDataError}>知道了</button>
  </div>;
}
