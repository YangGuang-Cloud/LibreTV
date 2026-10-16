import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAccountData, stopAccountData, waitForAccountWrites, refreshAccountData } from './account-data';
import { useAppStore } from './store';
import { upsertHistory, getHistory, clearAllHistory, saveProgress, exportConfig, importConfig, PERSIST_KEY } from './db';
import { initializeSyncSchema } from './sync-schema';
import { exchangeUserData } from './server-user-sync';
import { type SyncRequest } from './sync-model';

let server: Database.Database;
let offline: boolean;
const storageRead = vi.fn(() => { throw new Error('禁止读取个人本地数据'); });
const storageWrite = vi.fn(() => { throw new Error('禁止保存个人本地数据'); });
const transport = async (input: SyncRequest) => { if (offline) throw new TypeError('离线'); return exchangeUserData(server, 'account', input); };
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: storageRead, setItem: storageWrite });
  storageRead.mockClear(); storageWrite.mockClear(); offline = false;
  server = new Database(':memory:'); server.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user(id) VALUES ('account');"); initializeSyncSchema(server);
  useAppStore.setState(useAppStore.getInitialState(), true);
});
afterEach(() => { stopAccountData(); server.close(); vi.unstubAllGlobals(); });

describe('网页直接保存个人数据', () => {
  it('设置保存在服务器，失败恢复服务器确认的值，没有本地读写或恢复后的补传', async () => {
    await startAccountData('account', undefined, transport);
    useAppStore.getState().updateSettings({ adFilter: false }); await waitForAccountWrites();
    expect(useAppStore.getState().adFilter).toBe(false);
    offline = true;
    useAppStore.getState().updateSettings({ adFilter: true }); await waitForAccountWrites();
    expect(useAppStore.getState().adFilter).toBe(false);
    offline = false; await refreshAccountData();
    expect(useAppStore.getState().adFilter).toBe(false);
    expect(storageRead).not.toHaveBeenCalled(); expect(storageWrite).not.toHaveBeenCalled();
  });
  it('刷新会从服务器恢复偏好，下载缓存以外不创建 IndexedDB', async () => {
    await startAccountData('account', undefined, transport);
    useAppStore.getState().toggleLiveFavorite('https://example.com/live'); await waitForAccountWrites();
    stopAccountData(); useAppStore.setState(useAppStore.getInitialState(), true);
    await startAccountData('account', undefined, transport);
    expect(useAppStore.getState().liveFavorites).toEqual(['https://example.com/live']);
    expect(storageRead).not.toHaveBeenCalled(); expect(storageWrite).not.toHaveBeenCalled();
  });
  it('手动配置文件导入直接写账号，清空历史同时隐藏服务器进度', async () => {
    await startAccountData('account', undefined, transport);
    await importConfig(JSON.stringify({ name: 'LibreTV-Settings', data: { [PERSIST_KEY]: JSON.stringify({ state: { adFilter: false } }), viewingHistory: JSON.stringify([{ id: 's_file', sourceKey: 's', vodId: 'file', title: '测试', episodeIndex: 0, totalEpisodes: 1, playbackPosition: 55, duration: 500, timestamp: Date.now() }]) } }));
    await saveProgress('s', 'file', 0, 55, 500);
    expect(useAppStore.getState().adFilter).toBe(false); expect(getHistory()).toHaveLength(1);
    const backup = JSON.parse(await exportConfig()); expect(JSON.parse(backup.data.playbackProgress)).toHaveLength(1);
    await clearAllHistory(); expect(getHistory()).toEqual([]);
    expect(server.prepare("SELECT key FROM user_sync_data WHERE collection IN ('history', 'progress') AND deleted = 0").all()).toEqual([]);
    const retained = server.prepare("SELECT value, deleted FROM user_sync_data WHERE collection IN ('history', 'progress')").all() as { value: string | null; deleted: number }[];
    expect(retained).toHaveLength(2);
    expect(retained.every((row) => row.deleted === 1 && row.value !== null)).toBe(true);
    expect(storageWrite).not.toHaveBeenCalled();
  });
  it('历史写入失败不在页面生成一条看似已保存的记录', async () => {
    await startAccountData('account', undefined, transport); offline = true;
    await expect(upsertHistory({ sourceKey: 's', vodId: 'x', title: '失败记录', episodeIndex: 0, totalEpisodes: 1, playbackPosition: 5, duration: 500, timestamp: Date.now() })).rejects.toThrow();
    expect(getHistory()).toEqual([]);
    offline = false; await refreshAccountData(); expect(getHistory()).toEqual([]);
  });
  it('后台读取失败保留已显示内容', async () => {
    await startAccountData('account', undefined, transport);
    await upsertHistory({ sourceKey: 's', vodId: 'x', title: '已有记录', episodeIndex: 0, totalEpisodes: 1, playbackPosition: 5, duration: 500, timestamp: Date.now() });
    offline = true;
    expect(await refreshAccountData(true)).toBe(false);
    expect(getHistory().map((row) => row.title)).toEqual(['已有记录']);
  });

});
