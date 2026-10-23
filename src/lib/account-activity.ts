import type Database from 'better-sqlite3';

export type ActivityState = 'online' | 'watching' | 'offline';
export interface ActivityReport { accountId: string; producerId: string; sequence: number; watchedMs: number; state: ActivityState; }
export interface AccountActivity { status: ActivityState | 'unknown'; lastActiveAt: number | null; trackingSince: number | null; todaySeconds: number; totalSeconds: number; }
export const ACTIVITY_TTL = 75_000;
export function validActivityReport(value: unknown): value is ActivityReport {
  if (!value || typeof value !== 'object') return false;
  const row = value as ActivityReport;
  return typeof row.accountId === 'string' && row.accountId.length > 0 && row.accountId.length <= 128 && typeof row.producerId === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(row.producerId)
    && Number.isSafeInteger(row.sequence) && row.sequence > 0 && Number.isSafeInteger(row.watchedMs) && row.watchedMs >= 0
    && ['online', 'watching', 'offline'].includes(row.state);
}
export function initializeAccountActivity(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS account_activity (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    lastActiveAt INTEGER NOT NULL, trackingSince INTEGER NOT NULL, countedUntil INTEGER NOT NULL DEFAULT 0, totalMs INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS account_activity_producer (
    sessionId TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
    producerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, watchedMs INTEGER NOT NULL, state TEXT NOT NULL, receivedAt INTEGER NOT NULL,
    PRIMARY KEY(sessionId,producerId)
  );
  CREATE INDEX IF NOT EXISTS account_activity_user ON account_activity_producer(userId,receivedAt);
  CREATE TABLE IF NOT EXISTS account_watch_day (
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, day TEXT NOT NULL, watchedMs INTEGER NOT NULL,
    PRIMARY KEY(userId,day)
  );`);
}
const dayKey = (at: number) => new Date(at + 8 * 3600_000).toISOString().slice(0, 10);
export function saveAccountActivity(database: Database.Database, userId: string, sessionId: string, input: ActivityReport, now = Date.now()) {
  return database.transaction(() => {
    // Authentication supplies both IDs. Never accept identity or time from the payload.
    if (input.accountId !== userId) throw new Error('Account changed');
    if (!database.prepare('SELECT id FROM session WHERE id=? AND userId=?').get(sessionId, userId)) throw new Error('Session expired');
    database.prepare('DELETE FROM account_activity_producer WHERE userId=? AND receivedAt<?').run(userId, now - 86400_000);
    const previous = database.prepare('SELECT sequence,watchedMs,state,receivedAt FROM account_activity_producer WHERE sessionId=? AND producerId=?').get(sessionId, input.producerId) as { sequence: number; watchedMs: number; state: ActivityState; receivedAt: number } | undefined;
    if (previous && input.sequence <= previous.sequence) return;
    if (!previous) {
      const { count } = database.prepare("SELECT COUNT(*) AS count FROM account_activity_producer WHERE sessionId=? AND receivedAt>? AND state!='offline'").get(sessionId, now - ACTIVITY_TTL) as { count: number };
      if (count >= 16) throw new Error('Too many activity producers');
    }
    database.prepare('INSERT INTO account_activity(userId,lastActiveAt,trackingSince) VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET lastActiveAt=MAX(lastActiveAt,excluded.lastActiveAt)').run(userId, now, now);
    const account = database.prepare('SELECT countedUntil FROM account_activity WHERE userId=?').get(userId) as { countedUntil: number };
    const delta = previous && previous.state !== 'offline' ? Math.min(Math.max(0, input.watchedMs - previous.watchedMs), Math.max(0, now - previous.receivedAt), 45_000) : 0;
    // Credit wall-clock intervals once per account, even with two devices/tabs playing.
    let start = Math.max(now - delta, account.countedUntil);
    const credited = Math.max(0, now - start);
    if (credited > 0) {
      database.prepare('UPDATE account_activity SET totalMs=totalMs+?,countedUntil=? WHERE userId=?').run(credited, now, userId);
      while (start < now) {
        const day = dayKey(start);
        const midnight = Date.parse(day + 'T00:00:00+08:00') + 86400_000;
        const end = Math.min(now, midnight);
        database.prepare('INSERT INTO account_watch_day(userId,day,watchedMs) VALUES(?,?,?) ON CONFLICT(userId,day) DO UPDATE SET watchedMs=watchedMs+excluded.watchedMs').run(userId, day, end - start);
        start = end;
      }
    }
    database.prepare(`INSERT INTO account_activity_producer(sessionId,producerId,userId,sequence,watchedMs,state,receivedAt) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(sessionId,producerId) DO UPDATE SET sequence=excluded.sequence,watchedMs=excluded.watchedMs,state=excluded.state,receivedAt=excluded.receivedAt`).run(sessionId, input.producerId, userId, input.sequence, input.watchedMs, input.state, now);
  })();
}
export function readAccountActivity(database: Database.Database, userId: string, now = Date.now()): AccountActivity {
  const account = database.prepare('SELECT lastActiveAt,trackingSince,totalMs FROM account_activity WHERE userId=?').get(userId) as { lastActiveAt: number; trackingSince: number; totalMs: number } | undefined;
  const states = database.prepare(`SELECT p.state FROM account_activity_producer p JOIN session s ON s.id=p.sessionId
    JOIN user u ON u.id=p.userId WHERE p.userId=? AND p.receivedAt>? AND COALESCE(u.banned,0)=0
    AND (CASE WHEN typeof(s.expiresAt) IN ('integer','real') THEN s.expiresAt ELSE (julianday(s.expiresAt)-2440587.5)*86400000 END)>? AND EXISTS(SELECT 1 FROM account_authorization a WHERE a.userId=p.userId AND a.expiresAt>?)`).all(userId, now - ACTIVITY_TTL, now, now) as { state: ActivityState }[];
  const today = database.prepare('SELECT watchedMs FROM account_watch_day WHERE userId=? AND day=?').get(userId, dayKey(now)) as { watchedMs: number } | undefined;
  return { status: states.some((row) => row.state === 'watching') ? 'watching' : states.some((row) => row.state === 'online') ? 'online' : account ? 'offline' : 'unknown',
    lastActiveAt: account?.lastActiveAt ?? null, trackingSince: account?.trackingSince ?? null,
    todaySeconds: Math.floor((today?.watchedMs ?? 0) / 1000), totalSeconds: Math.floor((account?.totalMs ?? 0) / 1000) };
}
