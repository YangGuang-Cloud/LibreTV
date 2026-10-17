import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AdminConsole } from '@/components/admin-console';

export const metadata: Metadata = {
  title: '管理后台', robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <Suspense fallback={<div className="p-8 text-sm text-muted">正在连接后台…</div>}><AdminConsole /></Suspense>;
}
