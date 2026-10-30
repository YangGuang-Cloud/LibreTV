import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { initializeSyncSchema } from './sync-schema';
import { exchangeUserData } from './server-user-sync';
import { deleteAccountSearchRecord } from './account-admin-records';

let db: Database.Database;
const request = (accountId: string, key: string, baseVersion = 0, timestamp = 10) => ({ protocol: 1, accountId, cursor: 0, mutations: [{ id: `${key}-${baseVersion}-${timestamp}`, collection: 'search' as const, key, baseVersion, value: { text: key, timestamp } }] });
beforeEach(() => {
  db = new Database(':memory:');
  db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('a'),('b');");
  initializeSyncSchema(db);
  exchangeUserData(db, 'a', request('a', '目标'));
  exchangeUserData(db, 'a', request('a', '保留'));
  exchangeUserData(db, 'b', request('b', '目标'));
});
afterEach(() => db.close());
const rows = () => db.prepare('SELECT * FROM user_sync_data ORDER BY userId,collection,key').all();

it('彻底移除指定账号的单条搜索，不保留原值、墓碑或删除日志', () => {
  const otherRows = () => db.prepare("SELECT * FROM user_sync_data WHERE NOT(userId='a' AND collection='search' AND key='目标') ORDER BY userId,collection,key").all();
  const before = otherRows();
  const states = db.prepare('SELECT * FROM user_sync_state ORDER BY userId').all();
  deleteAccountSearchRecord(db, { userId: 'a', key: '目标', version: 1 });
  expect(db.prepare("SELECT * FROM user_sync_data WHERE userId='a' AND collection='search' AND key='目标'").get()).toBeUndefined();
  expect(otherRows()).toEqual(before);
  expect(db.prepare('SELECT * FROM user_sync_state ORDER BY userId').all()).toEqual(states);
  expect(rows()).toHaveLength(2);
});

it('客户端已隐藏的记录也可以永久删除，重复请求安全且不生成替代记录', () => {
  const hidden = exchangeUserData(db, 'a', { protocol: 1, accountId: 'a', cursor: 0, mutations: [{ id: 'hide', collection: 'search', key: '目标', baseVersion: 1, value: null }] });
  const version = hidden.results[0].record.version;
  deleteAccountSearchRecord(db, { userId: 'a', key: '目标', version });
  const before = rows();
  deleteAccountSearchRecord(db, { userId: 'a', key: '目标', version });
  expect(rows()).toEqual(before);
  expect(rows()).toHaveLength(2);
});

it('过期客户端操作不能复活已清除记录，之后的新搜索仍可重新保存', () => {
  deleteAccountSearchRecord(db, { userId: 'a', key: '目标', version: 1 });
  const stale = exchangeUserData(db, 'a', request('a', '目标', 1, 200));
  expect(stale.results[0].accepted).toBe(false);
  expect(db.prepare("SELECT * FROM user_sync_data WHERE userId='a' AND key='目标'").get()).toBeUndefined();
  const again = exchangeUserData(db, 'a', request('a', '目标', 0, 300));
  expect(again.results[0]).toMatchObject({ accepted: true, record: { value: { text: '目标', timestamp: 300 } } });
  expect(() => deleteAccountSearchRecord(db, { userId: 'a', key: '目标', version: 1 })).toThrow('已有更新');
});

it('旧版本和未知账号不能修改数据，同名记录不会删除其他集合', () => {
  db.prepare("INSERT INTO user_sync_data VALUES('a','history','同名','{}',0,NULL,3,50,'history')").run();
  const before = rows();
  for (const input of [{ userId: 'missing', key: '目标', version: 1 }, { userId: 'a', key: '目标', version: 999 }]) {
    expect(() => deleteAccountSearchRecord(db, input)).toThrow();
    expect(rows()).toEqual(before);
  }
  deleteAccountSearchRecord(db, { userId: 'a', key: '同名', version: 3 });
  expect(rows()).toEqual(before);
});

it.each([null, [], {}, { userId: 'a', key: '目标', version: -1 }, { userId: 'a', key: '', version: 1 }, { userId: 'a', key: '目标', version: '1' }])('校验删除参数 %j', (input) => {
  const before = rows();
  expect(() => deleteAccountSearchRecord(db, input)).toThrow();
  expect(rows()).toEqual(before);
});
