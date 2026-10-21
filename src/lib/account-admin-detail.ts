import type Database from 'better-sqlite3';
import { readAccountActivity } from './account-activity';
import { AccountInputError } from './account-users';
import { SYNC_COLLECTIONS, type SyncCollection } from './sync-model';
import type { AdminAccountDetail, AdminAccountSection, AdminAccountUser, AdminAccountRecord, AdminAccountSession } from './account-admin-model';

export const ACCOUNT_DETAIL_PAGE_SIZE = 30;
// Better Auth stores ISO dates; administrator updates may use epoch milliseconds.
const dateMillis = (value: number | string) => typeof value === 'number' ? value : Date.parse(value);
const sqlDate = (column: 'createdAt' | 'expiresAt') => `(CASE WHEN typeof(${column}) IN ('integer','real') THEN ${column} ELSE (julianday(${column}) - 2440587.5) * 86400000 END)`;
type StoredUser = Omit<AdminAccountUser, 'passwordAvailable' | 'createdAt' | 'updatedAt'> & { passwordAvailable: number; createdAt: number | string; updatedAt: number | string };
type StoredSession = Omit<AdminAccountSession, 'createdAt' | 'updatedAt' | 'expiresAt'> & { createdAt: number | string; updatedAt: number | string; expiresAt: number | string };
export function accountDetailQuery(params: URLSearchParams) {
  const userId = params.get('userId');
  const section = params.get('section') ?? 'history';
  const offsetText = params.get('offset') ?? '0';
  const offset = Number(offsetText);
  if (!userId || userId.length > 128) throw new AccountInputError('账号编号无效');
  if (![...SYNC_COLLECTIONS, 'sessions'].includes(section)) throw new AccountInputError('详情分类无效');
  if (!/^\d+$/.test(offsetText) || !Number.isSafeInteger(offset) || offset < 0) throw new AccountInputError('分页参数无效');
  return { userId, section: section as AdminAccountSection, offset };
}

/** 管理员只读视图：保留删除标记，不复用观看端过滤，不读取凭证或会话令牌。 */
export function readAccountDetail(database: Database.Database, userId: string, section: AdminAccountSection, offset: number, now = Date.now()): AdminAccountDetail {
  return database.transaction(() => {
    const row = database.prepare(`SELECT id, username, name, COALESCE(banned, 0) AS banned, createdAt, updatedAt,
      EXISTS(SELECT 1 FROM managed_password vault JOIN account credential
        ON credential.userId=vault.userId AND credential.providerId='credential' AND credential.password=vault.passwordHash
        WHERE vault.userId=user.id) AS passwordAvailable FROM user WHERE id=?`).get(userId) as StoredUser | undefined;
    if (!row) throw new AccountInputError('账号不存在', 404);
    const counts = Object.fromEntries(SYNC_COLLECTIONS.map((key) => [key, { total: 0, deleted: 0 }])) as AdminAccountDetail['counts'];
    const grouped = database.prepare('SELECT collection, COUNT(*) AS total, SUM(deleted) AS deleted FROM user_sync_data WHERE userId=? GROUP BY collection').all(userId) as { collection: SyncCollection; total: number; deleted: number }[];
    for (const group of grouped) if (group.collection in counts) counts[group.collection] = { total: group.total, deleted: group.deleted };
    const login = database.prepare('SELECT lastLoginAt FROM account_login_state WHERE userId=?').get(userId) as { lastLoginAt: number } | undefined;
    const { total: activeSessions } = database.prepare(`SELECT COUNT(*) AS total FROM session WHERE userId=? AND ${sqlDate('expiresAt')}>?`).get(userId, now) as { total: number };
    const records: AdminAccountRecord[] = [];
    let sessions: AdminAccountSession[] = [];
    if (section === 'sessions') {
      sessions = database.prepare(`SELECT createdAt, updatedAt, expiresAt, ipAddress, userAgent FROM session
        WHERE userId=? AND ${sqlDate('expiresAt')}>? ORDER BY ${sqlDate('createdAt')} DESC, id LIMIT ? OFFSET ?`).all(userId, now, ACCOUNT_DETAIL_PAGE_SIZE, offset).map((entry) => {
          const session = entry as StoredSession;
          return { ...session, createdAt: dateMillis(session.createdAt), updatedAt: dateMillis(session.updatedAt), expiresAt: dateMillis(session.expiresAt) };
        });
    } else {
      // Deleting a row changes its server timestamp, but must not promote an
      // old viewing/search event above genuinely recent activity.
      const activityOrder = section === 'history' || section === 'search'
        ? "CASE WHEN json_type(value, '$.timestamp') IN ('integer','real') THEN json_extract(value, '$.timestamp') ELSE updatedAt END"
        : 'updatedAt';
      const rows = database.prepare(`SELECT key, value, deleted, deletedAt, updatedAt FROM user_sync_data
        WHERE userId=? AND collection=? ORDER BY ${activityOrder} DESC, updatedAt DESC, key LIMIT ? OFFSET ?`).all(userId, section, ACCOUNT_DETAIL_PAGE_SIZE, offset) as { key: string; value: string | null; deleted: number; deletedAt: number | null; updatedAt: number }[];
      const lookup = database.prepare('SELECT value FROM user_sync_data WHERE userId=? AND collection=? AND key=?');
      for (const entry of rows) {
        const value: unknown = entry.value === null ? null : JSON.parse(entry.value);
        const record: AdminAccountRecord = { key: entry.key, value, deleted: !!entry.deleted, deletedAt: entry.deletedAt, updatedAt: entry.updatedAt };
        if (section === 'progress' || section === 'favorite') {
          const related = lookup.get(userId, section === 'progress' ? 'history' : 'recent', section === 'progress' ? entry.key.slice(0, entry.key.lastIndexOf('_')) : entry.key) as { value: string | null } | undefined;
          if (related?.value) {
            const data = JSON.parse(related.value);
            if (typeof data?.title === 'string') record.title = data.title;
            else if (typeof data?.name === 'string') record.title = data.name;
          }
        }
        records.push(record);
      }
    }
    return { user: { ...row, createdAt: dateMillis(row.createdAt), updatedAt: dateMillis(row.updatedAt), passwordAvailable: row.passwordAvailable === 1 }, counts, activeSessions, activity: readAccountActivity(database, userId, now), lastLoginAt: login?.lastLoginAt ?? null,
      section, records, sessions, total: section === 'sessions' ? activeSessions : counts[section].total, offset, limit: ACCOUNT_DETAIL_PAGE_SIZE };
  })();
}
