import { initializeLicenses } from './account-licenses';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { overviewAccounts } from './admin-overview';
import { initializeAccountActivity, ACTIVITY_TTL } from './account-activity';
it('按账号去重在线和观看人数，排除超时、停用、离线及过期会话，保留今日累计', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,banned INTEGER);
      INSERT INTO user VALUES('a',0),('b',0),('c',1),('d',0),('e',0),('f',0);
      CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,expiresAt);
      INSERT INTO session VALUES('a1','a',9999999999999),('a2','a','2030-01-01T00:00:00Z'),('b1','b',9999999999999),('c1','c',9999999999999),('d1','d','2020-01-01T00:00:00Z'),('e1','e',9999999999999),('f1','f',9999999999999);`);
    initializeLicenses(db);
    db.exec("INSERT INTO account_authorization SELECT id,9999999999999,0 FROM user");
  initializeAccountActivity(db);
    const now = Date.parse('2026-10-22T00:01:00+08:00');
    const put = db.prepare('INSERT INTO account_activity_producer VALUES(?,?,?,?,?,?,?)');
    for (const [session, user, state, at] of [['a1','a','online',now],['a2','a','watching',now],['b1','b','online',now],['c1','c','watching',now],['d1','d','watching',now],['e1','e','offline',now],['f1','f','watching',now - ACTIVITY_TTL]]) put.run(session, 'producer', user, 1, 0, state, at);
    db.prepare('INSERT INTO account_activity VALUES(?,?,?,?,?)').run('a', now, now, now, 120000);
    db.prepare('INSERT INTO account_activity VALUES(?,?,?,?,?)').run('b', now - 86400000, now - 86400000, now, 60000);
    db.exec("INSERT INTO account_watch_day VALUES('a','2026-10-22',60000),('b','2026-10-21',60000)");
    expect(overviewAccounts(db, now)).toEqual({ total: 6, disabled: 1, online: 2, watching: 1, todayActive: 1, todayWatchSeconds: 60, totalWatchSeconds: 180 });
    db.prepare('UPDATE account_authorization SET expiresAt=0 WHERE userId=?').run('a');
    expect(overviewAccounts(db, now)).toMatchObject({ online: 2, watching: 1 });
    db.prepare('UPDATE account_authorization SET expiresAt=? WHERE userId=?').run(now, 'a');
    expect(overviewAccounts(db, now)).toMatchObject({ online: 1, watching: 0, totalWatchSeconds: 180 });
  } finally { db.close(); }
});
