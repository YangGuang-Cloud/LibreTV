import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { initializeAccountLoginState, recordAccountLogin } from './account-login-state';

it('从旧会话补入最近登录，兼容 ISO 和毫秒格式，不使用账号资料更新时间', () => {
  const database = new Database(':memory:');
  try {
    database.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,updatedAt INTEGER);
      INSERT INTO user VALUES ('a',9999999999999),('b',9999999999999),('c',9999999999999);
      CREATE TABLE session(userId TEXT,createdAt);
      INSERT INTO session VALUES ('a','2026-01-01T00:00:00.000Z'),('a','2026-02-01T00:00:00.000Z'),('a',100),('b','invalid');`);
    initializeAccountLoginState(database);
    expect(database.prepare('SELECT * FROM account_login_state').all()).toEqual([{ userId: 'a', lastLoginAt: Date.parse('2026-02-01T00:00:00Z') }]);
    recordAccountLogin(database, 'a', Date.parse('2026-03-01T00:00:00Z'));
    recordAccountLogin(database, 'a', 200);
    initializeAccountLoginState(database);
    expect(database.prepare('SELECT lastLoginAt FROM account_login_state WHERE userId=?').get('a')).toEqual({ lastLoginAt: Date.parse('2026-03-01T00:00:00Z') });
    database.exec('DELETE FROM session');
    initializeAccountLoginState(database);
    expect(database.prepare('SELECT COUNT(*) AS count FROM account_login_state').get()).toEqual({ count: 1 });
  } finally { database.close(); }
});
