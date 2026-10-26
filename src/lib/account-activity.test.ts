import { initializeLicenses } from './account-licenses';
import Database from 'better-sqlite3';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { initializeAccountActivity, saveAccountActivity, readAccountActivity, validActivityReport, ACTIVITY_TTL, type ActivityState } from './account-activity';
let db: Database.Database;
const base = Date.parse('2026-10-21T12:00:00Z');
beforeEach(() => {
  db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,banned INTEGER); INSERT INTO user VALUES('a',0),('b',0);
    CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT REFERENCES user(id),expiresAt);
    INSERT INTO session VALUES('s1','a',9999999999999),('s2','a',9999999999999),('s3','b',9999999999999);`);
  initializeLicenses(db);
  db.exec("INSERT INTO account_authorization SELECT id,9999999999999,0 FROM user");
  initializeAccountActivity(db);
});
afterEach(() => db.close());
function report(sequence: number, watchedMs: number, state: ActivityState = 'watching', session = 's1', now = base + (sequence - 1) * 20000, user = 'a') {
  saveAccountActivity(db, user, session, { accountId: user, producerId: 'producer-id-123456', sequence, watchedMs, state }, now);
}
it('状态由近期心跳和有效会话决定，断开后自动离线，累计时长保留', () => {
  expect(readAccountActivity(db, 'a', base).status).toBe('unknown');
  report(1, 0, 'online'); report(2, 20000);
  expect(readAccountActivity(db, 'a', base + 20000)).toMatchObject({ status: 'watching', todaySeconds: 20, totalSeconds: 20 });
  expect(readAccountActivity(db, 'a', base + 20000 + ACTIVITY_TTL).status).toBe('offline');
  db.prepare('DELETE FROM session WHERE id=?').run('s1');
  expect(readAccountActivity(db, 'a', base + 20001)).toMatchObject({ status: 'offline', totalSeconds: 20 });
});
it('重复或迟到心跳不重复计时、不覆盖最新状态', () => {
  report(1, 0); report(2, 20000); report(3, 25000, 'online');
  report(2, 20000, 'watching', 's1', base + 41000);
  expect(readAccountActivity(db, 'a', base + 41000)).toMatchObject({ status: 'online', totalSeconds: 25, lastActiveAt: base + 40000 });
});
it('同一账号的两台设备同时观看只计一次，账号之间隔离', () => {
  report(1, 0); report(1, 0, 'watching', 's2'); report(2, 20000); report(2, 20000, 'watching', 's2');
  expect(readAccountActivity(db, 'a', base + 20000).totalSeconds).toBe(20);
  expect(readAccountActivity(db, 'b', base + 20000).totalSeconds).toBe(0);
});
it('跨北京时间零点分别计入两天，今日统计随日期切换', () => {
  const midnight = Date.parse('2026-10-22T00:00:00+08:00');
  report(1, 0, 'watching', 's1', midnight - 10000);
  report(2, 20000, 'watching', 's1', midnight + 10000);
  expect(readAccountActivity(db, 'a', midnight + 10000)).toMatchObject({ todaySeconds: 10, totalSeconds: 20 });
  expect(db.prepare('SELECT day,watchedMs FROM account_watch_day ORDER BY day').all()).toEqual([{ day: '2026-10-21', watchedMs: 10000 }, { day: '2026-10-22', watchedMs: 10000 }]);
});
it('暂停不增加时长，长断网与客户端伪造的大增量最多计45秒，不按影片进度累加', () => {
  report(1, 0, 'online'); report(2, 0, 'online'); report(3, 9999999, 'watching', 's1', base + 3600000);
  expect(readAccountActivity(db, 'a', base + 3600000).totalSeconds).toBe(45);
});
it('退出、停用、过期会话都不能显示在线，ISO 格式到期时间也受检查', () => {
  report(1, 0);
  db.prepare('UPDATE session SET expiresAt=? WHERE id=?').run('2020-01-01T00:00:00Z', 's1');
  expect(readAccountActivity(db, 'a', base).status).toBe('offline');
  db.prepare('UPDATE session SET expiresAt=? WHERE id=?').run('2030-01-01T00:00:00Z', 's1');
  expect(readAccountActivity(db, 'a', base).status).toBe('watching');
  db.prepare('UPDATE user SET banned=1 WHERE id=?').run('a');
  expect(readAccountActivity(db, 'a', base).status).toBe('offline');
});
it('拒绝跨账号、非法参数，初次接入不回填旧计数', () => {
  expect(() => report(1, 0, 'watching', 's3')).toThrow();
  expect(() => saveAccountActivity(db, 'a', 's1', { accountId: 'b', producerId: 'producer-id-123456', sequence: 1, watchedMs: 0, state: 'online' }, base)).toThrow();
  report(1, 9999999);
  expect(readAccountActivity(db, 'a', base).totalSeconds).toBe(0);
  for (const value of [null, {}, { accountId: 'a', producerId: 'bad', sequence: 1, watchedMs: 0, state: 'online' }, { accountId: 'a', producerId: 'producer-id-123456', sequence: 1, watchedMs: -1, state: 'online' }]) expect(validActivityReport(value)).toBe(false);
});

it('页面反复关闭再打开不会耗尽活动来源名额，离线来源不占活跃名额', () => {
  for (let i = 0; i < 20; i++) saveAccountActivity(db, 'a', 's1', { accountId: 'a', producerId: `producer-reload-${String(i).padStart(4, '0')}`, sequence: 1, watchedMs: 0, state: 'offline' }, base);
  report(1, 0, 'online');
  expect(readAccountActivity(db, 'a', base).status).toBe('online');
});
it('账号授权到期或未激活不能显示在线，历史观影时长仍保留', () => {
  report(1, 0); report(2, 20000);
  db.prepare('UPDATE account_authorization SET expiresAt=? WHERE userId=?').run(base + 20000, 'a');
  expect(readAccountActivity(db, 'a', base + 20000)).toMatchObject({ status: 'offline', totalSeconds: 20 });
  db.prepare('UPDATE account_authorization SET expiresAt=0 WHERE userId=?').run('a');
  expect(readAccountActivity(db, 'a', base + 20000)).toMatchObject({ status: 'watching', totalSeconds: 20 });
  db.prepare('DELETE FROM account_authorization WHERE userId=?').run('a');
  expect(readAccountActivity(db, 'a', base + 20000)).toMatchObject({ status: 'offline', totalSeconds: 20 });
});
