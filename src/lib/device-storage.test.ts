import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { createClientDatabase } from './db';

describe('设备存储只保留缓存和下载', () => {
  it('升级后移除个人数据和离线队列，保留下载任务及测速缓存', async () => {
    const name = 'libretv-account-device-test-' + crypto.randomUUID();
    const old = new Dexie(name);
    old.version(4).stores({ history: 'id', progress: 'key', searchHistory: 'text', syncRows: 'id', syncOutbox: 'id', syncMeta: 'key', downloads: 'id, createdAt', segmentMeta: 'key, episodeKey, lastAccess', liveProbe: 'url' });
    await old.table('history').put({ id: 'old-personal-data' }); await old.table('syncOutbox').put({ id: 'old-pending-write' });
    await old.table('downloads').put({ id: 'download', title: '下载文件', createdAt: 1 });
    await old.table('liveProbe').put({ url: 'https://example.com/live', ok: true, timestamp: 1 });
    old.close();
    const current = createClientDatabase(name);
    try {
      await current.open();
      expect(current.tables.map((table) => table.name).sort()).toEqual(['downloads', 'liveProbe', 'segmentMeta']);
      expect((await current.downloads.get('download'))?.title).toBe('下载文件');
      expect((await current.liveProbe.get('https://example.com/live'))?.ok).toBe(true);
    } finally { await current.delete(); }
  });
});
