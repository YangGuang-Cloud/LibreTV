import type Database from 'better-sqlite3';

/** One timestamp per account, retained independently of disposable sessions. */
export function initializeAccountLoginState(database: Database.Database) {
  database.transaction(() => {
    database.exec(`CREATE TABLE IF NOT EXISTS account_login_state (
      userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
      lastLoginAt INTEGER NOT NULL
    )`);
    // Existing sessions are the only available evidence for older logins.
    // Do not infer a login from profile updates or viewing/search activity.
    database.exec(`INSERT INTO account_login_state(userId,lastLoginAt)
      SELECT userId, MAX(CASE WHEN typeof(createdAt) IN ('integer','real') THEN createdAt
        ELSE CAST(ROUND((julianday(createdAt)-2440587.5)*86400000) AS INTEGER) END)
      FROM session GROUP BY userId HAVING MAX(CASE WHEN typeof(createdAt) IN ('integer','real') THEN createdAt
        ELSE CAST(ROUND((julianday(createdAt)-2440587.5)*86400000) AS INTEGER) END) IS NOT NULL
      ON CONFLICT(userId) DO NOTHING`);
  })();
}

export function recordAccountLogin(database: Database.Database, userId: string, at: number) {
  database.prepare(`INSERT INTO account_login_state(userId,lastLoginAt) VALUES(?,?)
    ON CONFLICT(userId) DO UPDATE SET lastLoginAt=MAX(account_login_state.lastLoginAt,excluded.lastLoginAt)`).run(userId, at);
}
