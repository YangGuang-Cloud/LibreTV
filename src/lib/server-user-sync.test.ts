import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeSyncSchema } from './sync-schema';
import { exchangeUserData } from './server-user-sync';
import { OnlineAccountClient } from './account-data-client';
import { type SyncRequest } from './sync-model';

let database: Database.Database;
const client = (userId = 'a') => new OnlineAccountClient(userId, async (request) => exchangeUserData(database, userId, request));
const search = (text: string, timestamp = 1000) => ({ collection: 'search' as const, key: text, value: { text, timestamp } });
const row = (collection: string, key: string) => database.prepare('SELECT * FROM user_sync_data WHERE userId = ? AND collection = ? AND key = ?').get('a', collection, key) as { value: string | null; deleted: number; deletedAt: number | null; version: number; updatedAt: number; mutationId: string };
const read = (cursor = 0, userId = 'a') => exchangeUserData(database, userId, { protocol: 1, accountId: userId, cursor, mutations: [] });
beforeEach(() => {
  database = new Database(':memory:');
  database.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user(id) VALUES ('a'), ('b');");
  initializeSyncSchema(database);
});
afterEach(() => database.close());

describe('个人记录软删除，只保留最后内容', () => {
  it('删除保留完整内容，但增量、全量和其他客户端都只收到删除标记', async () => {
    const web = client(); const ios = client();
    const entry = { id: 'source_film', sourceKey: 'source', vodId: 'film', title: '删除前完整片名', pic: 'https://example.com/cover.jpg', episodeIndex: 2, totalEpisodes: 8, playbackPosition: 123, duration: 900, timestamp: 1000 };
    await web.write([{ collection: 'history', key: entry.id, value: entry }]);
    await ios.refresh();
    expect(ios.values('history')).toEqual([entry]);
    const before = row('history', entry.id);
    await web.write([{ collection: 'history', key: entry.id, value: null }]);
    const deleted = row('history', entry.id);
    expect(JSON.parse(deleted.value!)).toEqual(entry);
    expect(deleted.deleted).toBe(1); expect(deleted.deletedAt).toBe(deleted.updatedAt);
    expect(deleted.version).toBeGreaterThan(before.version);
    for (const response of [read(), read(before.version)]) {
      expect(response.records).toEqual([{ collection: 'history', key: entry.id, value: null, version: deleted.version, updatedAt: deleted.updatedAt }]);
      expect(JSON.stringify(response)).not.toContain(entry.title);
      expect(JSON.stringify(response)).not.toContain(entry.pic);
    }
    await ios.refresh(); expect(ios.values('history')).toEqual([]);
    const fresh = client(); await fresh.refresh(); expect(fresh.values('history')).toEqual([]);
    expect(read(0, 'b').records).toEqual([]);
  });

  it('清空逐条软删除搜索历史，不影响其他集合和其他账号', async () => {
    const a = client(); const b = client('b');
    await a.write([search('词一'), search('词二'), { collection: 'preference', key: 'adFilter', value: false }]);
    await b.write([search('词一')]);
    await a.write((current) => current.rows().filter((record) => record.collection === 'search' && record.value !== null).map((record) => ({ collection: record.collection, key: record.key, value: null })));
    expect(a.values('search')).toEqual([]);
    for (const key of ['词一', '词二']) {
      expect(row('search', key).deleted).toBe(1);
      expect(JSON.parse(row('search', key).value!)).toEqual({ text: key, timestamp: 1000 });
    }
    expect(row('preference', 'adFilter').deleted).toBe(0);
    expect(a.get('preference', 'adFilter')).toBe(false);
    await b.refresh(); expect(b.values('search')).toEqual([{ text: '词一', timestamp: 1000 }]);
  });

  it('可见条数淘汰也保留内容，已删除行不重复参与淘汰', async () => {
    const a = client();
    await a.write(Array.from({ length: 11 }, (_, index) => search(`词${index}`, 1000 + index)));
    expect(a.values('search')).toHaveLength(10);
    const evicted = row('search', '词0');
    expect(evicted.deleted).toBe(1);
    expect(JSON.parse(evicted.value!)).toEqual({ text: '词0', timestamp: 1000 });
    await a.write([{ collection: 'preference', key: 'adFilter', value: false }]);
    expect(row('search', '词0')).toEqual(evicted);
    expect(database.prepare("SELECT COUNT(*) AS n FROM user_sync_data WHERE collection = 'search'").get()).toEqual({ n: 11 });
  });

  it('重复删除可幂等确认，旧版本不能复活；主动重搜正常更新同一行', async () => {
    const a = client(); await a.write([search('词')]);
    const original = row('search', '词');
    const request: SyncRequest = { protocol: 1, accountId: 'a', cursor: original.version, mutations: [{ id: 'delete-once', collection: 'search', key: '词', baseVersion: original.version, value: null }] };
    const deleted = exchangeUserData(database, 'a', request);
    const retained = row('search', '词');
    expect(deleted.results[0]).toMatchObject({ accepted: true, record: { value: null } });
    expect(exchangeUserData(database, 'a', request).cursor).toBe(deleted.cursor);
    expect(row('search', '词')).toEqual(retained);
    const stale = exchangeUserData(database, 'a', { ...request, mutations: [{ id: 'stale-write', collection: 'search', key: '词', baseVersion: original.version, value: { text: '词', timestamp: 2000 } }] });
    expect(stale.results[0]).toMatchObject({ accepted: false, record: { value: null } });
    expect(row('search', '词')).toEqual(retained);
    await a.write([search('词', 3000)]);
    expect(row('search', '词').deleted).toBe(0); expect(row('search', '词').deletedAt).toBeNull();
    expect(a.values('search')).toEqual([{ text: '词', timestamp: 3000 }]);
    expect(database.prepare("SELECT COUNT(*) AS n FROM user_sync_data WHERE collection = 'search'").get()).toEqual({ n: 1 });
  });

  it('删除不存在的记录也能正常同步，重复删除不会清空保留的原内容', async () => {
    const a = client();
    await a.write([{ collection: 'search', key: '从未存在', value: null }]);
    expect(row('search', '从未存在')).toMatchObject({ deleted: 1, value: null });
    await a.write([search('已有')]);
    await a.write([{ collection: 'search', key: '已有', value: null }]);
    await a.write([{ collection: 'search', key: '已有', value: null }]);
    expect(row('search', '已有').deleted).toBe(1);
    expect(JSON.parse(row('search', '已有').value!)).toEqual({ text: '已有', timestamp: 1000 });
  });

  it('旧数据库升级保留正常记录和旧墓碑，迁移可重复运行', () => {
    const legacy = new Database(':memory:');
    try {
      legacy.exec(`CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user(id) VALUES ('a');
        CREATE TABLE user_sync_state(userId TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
        INSERT INTO user_sync_state VALUES ('a', 2);
        CREATE TABLE user_sync_data(userId TEXT, collection TEXT, key TEXT, value TEXT, version INTEGER, updatedAt INTEGER, mutationId TEXT, PRIMARY KEY(userId, collection, key));
        INSERT INTO user_sync_data VALUES ('a', 'search', '原有', '{"text":"原有","timestamp":1000}', 1, 1000, 'first');
        INSERT INTO user_sync_data VALUES ('a', 'search', '旧删除', NULL, 2, 2000, 'removed');`);
      initializeSyncSchema(legacy); initializeSyncSchema(legacy);
      const rows = legacy.prepare('SELECT key, value, deleted, deletedAt FROM user_sync_data ORDER BY version').all();
      expect(rows).toEqual([{ key: '原有', value: '{"text":"原有","timestamp":1000}', deleted: 0, deletedAt: null }, { key: '旧删除', value: null, deleted: 1, deletedAt: 2000 }]);
      const result = exchangeUserData(legacy, 'a', { protocol: 1, accountId: 'a', cursor: 0, mutations: [] });
      expect(result.records.map((record) => record.value)).toEqual([{ text: '原有', timestamp: 1000 }, null]);
    } finally { legacy.close(); }
  });
});
