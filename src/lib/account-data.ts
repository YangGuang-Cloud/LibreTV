'use client';

import { useSyncExternalStore } from 'react';
import { AccountDataError, OnlineAccountClient, setAccountClient, cachedAccountClient, type AccountTransport, type AccountChange } from './account-data-client';
import { useAppStore, type LiveRecentEntry } from './store';
import { SYNC_PREFERENCE_KEYS, syncId } from './sync-model';
import { settingsMap } from './sync-settings';

export interface AccountDataStatus { state: 'idle' | 'loading' | 'saving' | 'error'; message: string; lastRead: number | null; }
const initialStatus: AccountDataStatus = { state: 'idle', message: '', lastRead: null };
let status = initialStatus;
const subscribers = new Set<() => void>();
const updateStatus = (patch: Partial<AccountDataStatus>) => { status = { ...status, ...patch }; for (const listener of subscribers) listener(); };
const subscribe = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
export const useAccountDataStatus = () => useSyncExternalStore(subscribe, () => status, () => initialStatus);
export const dismissAccountDataError = () => updateStatus({ message: '' });
let stop = () => {};
let writes = new Set<Promise<unknown>>();
export async function waitForAccountWrites() {
  await Promise.allSettled([...writes]);
  await cachedAccountClient()?.settled();
}
export function stopAccountData() { stop(); stop = () => {}; setAccountClient(null); }
export async function refreshAccountData(force = false): Promise<boolean> {
  const client = cachedAccountClient(); if (!client) return false;
  updateStatus({ state: 'loading' });
  try { await client.refresh(force); updateStatus({ state: 'idle', message: '', lastRead: Date.now() }); return true; }
  catch { return false; }
}

/** 页面订阅统一的会话内数据视图，最终失败回滚；关闭页面后不补传。 */
export async function startAccountData(accountId: string, changed?: () => void, transport?: AccountTransport) {
  stopAccountData();
  status = initialStatus;
  let stopped = false; let applying = false; let offStore = () => {};
  let snapshot = settingsMap(useAppStore.getState());
  let timer: ReturnType<typeof setInterval> | null = null;
  writes = new Set();
  const restore = () => {
    if (stopped) return;
    const rows = new Map(client.rows().map((row) => [syncId(row.collection, row.key), { collection: row.collection, key: row.key, value: row.value }]));
    const defaults = useAppStore.getInitialState();
    const patch: Record<string, unknown> = {};
    for (const key of SYNC_PREFERENCE_KEYS) patch[key] = defaults[key];
    const favorites: string[] = []; const recent: LiveRecentEntry[] = [];
    for (const row of rows.values()) {
      if (row.collection === 'preference') patch[row.key] = row.value ?? defaults[row.key as typeof SYNC_PREFERENCE_KEYS[number]];
      else if (row.collection === 'favorite' && row.value === true) favorites.push(row.key);
      else if (row.collection === 'recent' && row.value) recent.push(row.value as LiveRecentEntry);
    }
    patch.liveFavorites = favorites;
    patch.liveRecent = recent.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
    applying = true;
    try { useAppStore.setState(patch); snapshot = settingsMap(useAppStore.getState()); }
    finally { applying = false; }
    changed?.();
  };
  const client = new OnlineAccountClient(accountId, transport, () => { if (!stopped) { restore(); updateStatus({ lastRead: Date.now() }); } }, (error, writing) => {
    if (!stopped) updateStatus({ state: 'error', message: error instanceof AccountDataError && error.status === 401 ? error.message : writing ? '部分修改未能同步，请检查网络后重试。' : status.message });
  });
  setAccountClient(client);
  const refresh = () => { if (!stopped) void refreshAccountData(); };
  const visibility = () => { if (document.visibilityState === 'visible') refresh(); };
  stop = () => {
    stopped = true; offStore(); if (timer) clearInterval(timer); client.close();
    window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visibility);
  };
  updateStatus({ state: 'loading', message: '' });
  await client.refresh();
  if (stopped) return;
  offStore = useAppStore.subscribe((state) => {
    if (applying || stopped) return;
    const next = settingsMap(state);
    const previous = snapshot; snapshot = next;
    const changes: AccountChange[] = [];
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      if (JSON.stringify(previous.get(id)?.value) === JSON.stringify(next.get(id)?.value)) continue;
      const row = next.get(id) || previous.get(id)!;
      changes.push({ ...row, value: next.has(id) ? row.value : null });
    }
    if (!changes.length) return;
    updateStatus({ state: 'saving', message: '' });
    const request = client.write(changes).then(() => {
      if (!stopped) updateStatus({ state: 'idle' });
    }).catch(() => { /* client 统一报告保存错误 */ }).finally(() => {
      writes.delete(request);
      if (stopped) return;
      restore();
    });
    writes.add(request);
  });
  timer = setInterval(refresh, 20_000);
  window.addEventListener('online', refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visibility);
  updateStatus({ state: 'idle', lastRead: Date.now() });
}
