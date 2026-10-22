import type Database from 'better-sqlite3';
import { ACTIVITY_TTL } from './account-activity';
import type { OverviewAccounts } from './admin-overview-model';

export function overviewAccounts(database: Database.Database, now = Date.now()): OverviewAccounts {
  return database.transaction(() => {
    const day = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
    const midnight = Date.parse(day + 'T00:00:00+08:00');
    const users = database.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN banned=1 THEN 1 ELSE 0 END),0) AS disabled FROM user').get() as { total: number; disabled: number };
    const presence = database.prepare(`SELECT COUNT(DISTINCT p.userId) AS online,
      COUNT(DISTINCT CASE WHEN p.state='watching' THEN p.userId END) AS watching
      FROM account_activity_producer p JOIN session s ON s.id=p.sessionId JOIN user u ON u.id=p.userId
      WHERE p.receivedAt>? AND p.state IN ('online','watching') AND COALESCE(u.banned,0)=0
      AND (CASE WHEN typeof(s.expiresAt) IN ('integer','real') THEN s.expiresAt ELSE (julianday(s.expiresAt)-2440587.5)*86400000 END)>?`).get(now - ACTIVITY_TTL, now) as { online: number; watching: number };
    const { todayActive } = database.prepare('SELECT COUNT(*) AS todayActive FROM account_activity WHERE lastActiveAt>=?').get(midnight) as { todayActive: number };
    const { today } = database.prepare('SELECT COALESCE(SUM(watchedMs),0) AS today FROM account_watch_day WHERE day=?').get(day) as { today: number };
    const { total } = database.prepare('SELECT COALESCE(SUM(totalMs),0) AS total FROM account_activity').get() as { total: number };
    return { ...users, ...presence, todayActive, todayWatchSeconds: Math.floor(today / 1000), totalWatchSeconds: Math.floor(total / 1000) };
  })();
}
