import type Database from 'better-sqlite3';
import { SYNC_PAGE_SIZE, SYNC_PROTOCOL, type SyncCollection, type SyncRecord, type SyncRequest, type SyncResponse } from './sync-model';

interface Row { collection: SyncCollection; key: string; value: string | null; deleted: number; deletedAt: number | null; version: number; updatedAt: number; mutationId: string; }
const decode = (row: Row): SyncRecord => ({ collection: row.collection, key: row.key, value: row.deleted || row.value === null ? null : JSON.parse(row.value), version: row.version, updatedAt: row.updatedAt });
export class SyncRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** 一个事务内写入、判定冲突和读取变更，响应丢失后可安全重试相同 mutation id。 */
export function exchangeUserData(database: Database.Database, userId: string, input: SyncRequest): SyncResponse {
  if (input.accountId !== userId) throw new SyncRequestError('登录账号已变化，请刷新页面', 409);
  return database.transaction(() => {
    database.prepare('INSERT OR IGNORE INTO user_sync_state(userId, revision) VALUES (?, 0)').run(userId);
    let revision = (database.prepare('SELECT revision FROM user_sync_state WHERE userId = ?').get(userId) as { revision: number }).revision;
    if (input.cursor > revision) throw new SyncRequestError('账号数据版本已变化，请重新拉取', 409);
    const get = database.prepare('SELECT * FROM user_sync_data WHERE userId = ? AND collection = ? AND key = ?');
    const put = database.prepare(`INSERT INTO user_sync_data(userId, collection, key, value, deleted, deletedAt, version, updatedAt, mutationId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, collection, key) DO UPDATE SET value=excluded.value, deleted=excluded.deleted, deletedAt=excluded.deletedAt, version=excluded.version, updatedAt=excluded.updatedAt, mutationId=excluded.mutationId`);
    const insert = (collection: SyncCollection, key: string, value: unknown, id: string, previous?: Row) => {
      const deleted = value === null;
      const now = Date.now();
      // 只保留这一行的最后内容，不记录每次变化；删除仅改标记与版本。
      const storedValue = deleted ? previous?.value ?? null : JSON.stringify(value);
      put.run(userId, collection, key, storedValue, deleted ? 1 : 0, deleted ? now : null, ++revision, now, id);
    };
    let rowCount = (database.prepare('SELECT COUNT(*) AS count FROM user_sync_data WHERE userId = ?').get(userId) as { count: number }).count;
    const accepted = input.mutations.map((mutation) => {
      const previous = get.get(userId, mutation.collection, mutation.key) as Row | undefined;
      if (previous?.mutationId === mutation.id) return true;
      if ((previous?.version || 0) !== mutation.baseVersion) return false;
      if (!previous && ++rowCount > 50_000) throw new SyncRequestError('账号记录数量已达上限，请联系管理员', 507);
      insert(mutation.collection, mutation.key, mutation.value, mutation.id, previous);
      return true;
    });
    // 可见记录超限时同样软删除；保留服务器内容，并通知旧设备移除。
    const limits = { history: 100, progress: 5000, search: 10, recent: 20, favorite: 1000 } as const;
    for (const [collection, limit] of input.mutations.length ? Object.entries(limits) : []) {
      const order = collection === 'progress' ? "json_extract(value, '$.updatedAt')" : "json_extract(value, '$.timestamp')";
      const old = database.prepare(`SELECT * FROM user_sync_data WHERE userId = ? AND collection = ? AND deleted = 0 AND value IS NOT NULL ORDER BY ${order} DESC, version DESC LIMIT -1 OFFSET ?`).all(userId, collection, limit) as Row[];
      for (const row of old) insert(row.collection, row.key, null, `retained:${revision + 1}`, row);
    }
    database.prepare('UPDATE user_sync_state SET revision = ? WHERE userId = ?').run(revision, userId);
    const changes = database.prepare('SELECT * FROM user_sync_data WHERE userId = ? AND version > ? ORDER BY version LIMIT ?').all(userId, input.cursor, SYNC_PAGE_SIZE + 1) as Row[];
    const more = changes.length > SYNC_PAGE_SIZE;
    const records = changes.slice(0, SYNC_PAGE_SIZE).map(decode);
    return {
      protocol: SYNC_PROTOCOL, accountId: userId, cursor: more ? records[records.length - 1].version : revision, more, records,
      results: input.mutations.map((mutation, index) => {
        const row = get.get(userId, mutation.collection, mutation.key) as Row | undefined;
        // 从未存在但 baseVersion 非零的非法旧更新，不生成可复活的零版本确认。
        return { id: mutation.id, accepted: accepted[index], record: row ? decode(row) : { collection: mutation.collection, key: mutation.key, value: null, version: 0, updatedAt: 0 } };
      }),
    };
  })();
}
