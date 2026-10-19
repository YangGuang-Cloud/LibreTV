import Database from 'better-sqlite3';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { initializeSyncSchema } from './sync-schema';
import { initializePasswordVault } from './account-password-vault';
import { exchangeUserData } from './server-user-sync';
import { accountDetailQuery, readAccountDetail } from './account-admin-detail';

let database: Database.Database;
beforeEach(() => {
  database = new Database(':memory:');
  database.exec(`CREATE TABLE user(id TEXT PRIMARY KEY, username TEXT, name TEXT, banned INTEGER, createdAt INTEGER, updatedAt INTEGER);
    INSERT INTO user VALUES ('a','alice','用户甲',0,1,2),('b','bob','用户乙',1,1,2);
    CREATE TABLE account(userId TEXT, providerId TEXT, password TEXT);
    INSERT INTO account VALUES ('a','credential','secret-hash');
    CREATE TABLE session(id TEXT, userId TEXT, token TEXT, createdAt INTEGER, updatedAt INTEGER, expiresAt INTEGER, ipAddress TEXT, userAgent TEXT);
    INSERT INTO session VALUES ('s1','a','secret-token',1,2,9999999999999,'192.0.2.1','iOS'),('s2','a','expired-token',1,2,10,'192.0.2.2','expired'),('s3','b','other-token',1,2,9999999999999,'192.0.2.3','other');`);
  initializeSyncSchema(database); initializePasswordVault(database);
});
afterEach(() => database.close());
function put(userId: string, collection: string, key: string, value: unknown, deleted = 0, at = 100) {
  database.prepare('INSERT INTO user_sync_data(userId,collection,key,value,deleted,deletedAt,version,updatedAt,mutationId) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(userId, collection, key, value === null ? null : JSON.stringify(value), deleted, deleted ? at : null, 1, at, `${userId}-${key}`);
}
it('管理员能读取逻辑删除后的原内容，观看端仍隐藏；详情读取不修改任何数据', () => {
  put('a', 'search', '保留关键词', { text: '保留关键词', timestamp: 5 });
  const input = { protocol: 1, accountId: 'a', cursor: 0, mutations: [{ id: 'delete', collection: 'search' as const, key: '保留关键词', baseVersion: 1, value: null }] };
  const sync = exchangeUserData(database, 'a', input);
  expect(sync.results[0].record.value).toBeNull();
  const before = database.prepare('SELECT * FROM user_sync_data').all();
  const detail = readAccountDetail(database, 'a', 'search', 0);
  expect(detail.records[0]).toMatchObject({ key: '保留关键词', value: { text: '保留关键词' }, deleted: true });
  expect(detail.records[0].deletedAt).toBeTypeOf('number');
  expect(detail.counts.search).toEqual({ total: 1, deleted: 1 });
  expect(database.prepare('SELECT * FROM user_sync_data').all()).toEqual(before);
});
it('所有分类和计数按账号隔离，禁用账号也能查看，旧墓碑保留无内容状态', () => {
  put('a', 'history', 'film', { title: '甲的影片' });
  put('b', 'history', 'film', { title: '乙的影片' });
  put('b', 'search', '旧记录', null, 1);
  expect(readAccountDetail(database, 'a', 'history', 0).records.map((row) => row.value)).toEqual([{ title: '甲的影片' }]);
  const detail = readAccountDetail(database, 'b', 'search', 0);
  expect(detail.user.banned).toBe(1);
  expect(detail.records[0]).toMatchObject({ value: null, deleted: true });
  expect(detail.counts.history.total).toBe(1);
  expect(detail.activeSessions).toBe(1);
  expect(() => readAccountDetail(database, 'missing', 'search', 0)).toThrow('账号不存在');
});
it('历史按服务器时间稳定分页，没有遗漏或重复，所有保留记录都可翻页', () => {
  for (let i = 0; i < 65; i++) put('a', 'search', `key-${String(i).padStart(3, '0')}`, { text: String(i) }, i % 2, 100 + i);
  const pages = [0, 30, 60].map((offset) => readAccountDetail(database, 'a', 'search', offset));
  expect(pages.map((page) => page.records.length)).toEqual([30, 30, 5]);
  expect(pages[0].total).toBe(65);
  expect(new Set(pages.flatMap((page) => page.records.map((row) => row.key))).size).toBe(65);
  expect(pages[0].records[0].key).toBe('key-064');
});
it('会话仅返回有效记录和安全字段，不包含令牌、密码哈希或加密副本', () => {
  const detail = readAccountDetail(database, 'a', 'sessions', 0, 100);
  expect(detail.total).toBe(1);
  expect(detail.sessions).toEqual([{ createdAt: 1, updatedAt: 2, expiresAt: 9999999999999, ipAddress: '192.0.2.1', userAgent: 'iOS' }]);
  expect(JSON.stringify(detail)).not.toMatch(/secret-token|expired-token|secret-hash|other-token|passwordHash|ciphertext/);
});
it('分集进度关联本账号的影片名称，支持含下划线的影片标识与已隐藏影片', () => {
  put('a', 'history', 'source_film_id', { title: '已隐藏的片名' }, 1);
  put('a', 'progress', 'source_film_id_2', { position: 60, duration: 600 });
  put('b', 'history', 'source_film_id', { title: '别人的片名' });
  expect(readAccountDetail(database, 'a', 'progress', 0).records[0].title).toBe('已隐藏的片名');
});
it('拒绝无效账号、分类、负数和非整数分页参数', () => {
  for (const query of ['section=search', 'userId=a&section=unknown', 'userId=a&offset=-1', 'userId=a&offset=0.5', 'userId=a&offset=Infinity', 'userId=a&offset=9007199254740992']) {
    expect(() => accountDetailQuery(new URLSearchParams(query))).toThrow();
  }
  expect(accountDetailQuery(new URLSearchParams('userId=a'))).toEqual({ userId: 'a', section: 'history', offset: 0 });
});

it('兼容框架 ISO 日期与管理员写入的毫秒日期，过期 ISO 会话也必须过滤', () => {
  database.prepare('UPDATE user SET createdAt=?,updatedAt=? WHERE id=?').run('2026-01-01T00:00:00.000Z', 12345, 'a');
  const insert = database.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?)');
  insert.run('iso-expired', 'a', 'old', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z', null, 'expired-iso');
  insert.run('iso-active', 'a', 'active', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2030-01-01T00:00:00.000Z', null, 'active-iso');
  const detail = readAccountDetail(database, 'a', 'sessions', 0, Date.parse('2026-02-01T00:00:00Z'));
  expect(detail.user.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
  expect(detail.user.updatedAt).toBe(12345);
  expect(detail.total).toBe(2);
  expect(detail.sessions[0].userAgent).toBe('active-iso');
  expect(detail.sessions[0].expiresAt).toBe(Date.parse('2030-01-01T00:00:00Z'));
  expect(detail.sessions.some((session) => session.userAgent === 'expired-iso')).toBe(false);
});
