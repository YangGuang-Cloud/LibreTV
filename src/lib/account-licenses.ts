import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { passwordVaultKey } from './account-password-vault';
export class LicenseError extends Error { constructor(message: string, public status = 400) { super(message); } }
export interface AccountAccess { state: 'active' | 'expired' | 'unactivated'; expiresAt: number | null; }
// SQLite uses 0 for unlimited duration/deadline; public account expiry is null when active indefinitely.
const DAY = 86400_000;
export function initializeLicenses(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS authorization_code (
    id TEXT PRIMARY KEY, codeHash TEXT NOT NULL UNIQUE, encrypted TEXT NOT NULL, label TEXT NOT NULL,
    days INTEGER NOT NULL, redeemBefore INTEGER NOT NULL, createdAt INTEGER NOT NULL, revokedAt INTEGER,
    userId TEXT REFERENCES user(id), redeemedAt INTEGER, grantedUntil INTEGER);
    CREATE INDEX IF NOT EXISTS authorization_code_user ON authorization_code(userId);
    CREATE TABLE IF NOT EXISTS account_authorization (userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    expiresAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);`);
}
export function accountAccess(db: Database.Database, userId: string, now = Date.now()): AccountAccess {
  const row = db.prepare('SELECT expiresAt FROM account_authorization WHERE userId=?').get(userId) as { expiresAt: number } | undefined;
  return { state: row ? (row.expiresAt === 0 || row.expiresAt > now) ? 'active' : 'expired' : 'unactivated', expiresAt: row?.expiresAt || null };
}
const normalized = (code: string) => code.trim().toUpperCase().replace(/[-\s]/g, '');
const digest = (code: string) => crypto.createHash('sha256').update(normalized(code)).digest('hex');
function seal(db: Database.Database, id: string, code: string) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', passwordVaultKey(db, true), iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
function unseal(db: Database.Database, id: string, value: string) {
  const data = Buffer.from(value, 'base64'), cipher = crypto.createDecipheriv('aes-256-gcm', passwordVaultKey(db, false), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
export function generateLicenses(db: Database.Database, input: Record<string, unknown>, now = Date.now()) {
  const { count } = input;
  const days = input.days === null ? 0 : input.days;
  const redeemBefore = input.redeemBefore === null ? 0 : input.redeemBefore;
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 100) throw new LicenseError('每次可生成 1–100 个授权码');
  if (input.days !== null && (!Number.isInteger(days) || Number(days) < 1 || Number(days) > 3650)) throw new LicenseError('授权天数需为 1–3650 天，或选择无限期');
  if (input.redeemBefore !== null && (!Number.isSafeInteger(redeemBefore) || Number(redeemBefore) <= now || Number(redeemBefore) > now + 3650 * DAY)) throw new LicenseError('请设置有效的最晚兑换时间（十年内）');
  if (label.length > 100) throw new LicenseError('备注最多 100 个字符');
  return db.transaction(() => Array.from({ length: Number(count) }, () => {
    const id = crypto.randomUUID(), code = 'LUNA-' + crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
    db.prepare('INSERT INTO authorization_code(id,codeHash,encrypted,label,days,redeemBefore,createdAt) VALUES(?,?,?,?,?,?,?)')
      .run(id, digest(code), seal(db, id, code), label, days, redeemBefore, now);
    return { id, code };
  }))();
}
export function redeemLicense(db: Database.Database, userId: string, code: unknown, now = Date.now()) {
  if (typeof code !== 'string' || code.length > 150 || !code.trim()) throw new LicenseError('请输入授权码');
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM authorization_code WHERE codeHash=?').get(digest(code)) as { id: string; userId: string | null; revokedAt: number | null; redeemBefore: number; days: number } | undefined;
    if (!row || row.userId || row.revokedAt !== null || (row.redeemBefore !== 0 && row.redeemBefore <= now)) throw new LicenseError('授权码无效、已使用或已失效');
    const user = db.prepare('SELECT banned FROM user WHERE id=?').get(userId) as { banned: number | null } | undefined;
    if (!user || user.banned) throw new LicenseError('账号不可用', 403);
    const access = accountAccess(db, userId, now);
    if (access.state === 'active' && access.expiresAt === null) throw new LicenseError('当前账号已是无限期，无需续期');
    const until = row.days === 0 ? 0 : Math.max(now, access.expiresAt ?? 0) + row.days * DAY;
    const claimed = db.prepare('UPDATE authorization_code SET userId=?,redeemedAt=?,grantedUntil=? WHERE id=? AND userId IS NULL AND revokedAt IS NULL').run(userId, now, until, row.id);
    if (claimed.changes !== 1) throw new LicenseError('授权码已被使用', 409);
    db.prepare('INSERT INTO account_authorization(userId,expiresAt,updatedAt) VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET expiresAt=excluded.expiresAt,updatedAt=excluded.updatedAt').run(userId, until, now);
    return { state: 'active' as const, expiresAt: until || null };
  }).immediate();
}
export function listLicenses(db: Database.Database, offset = 0, id?: string, now = Date.now()) {
  const query = `SELECT c.id,c.label,c.days,c.redeemBefore,c.createdAt,c.revokedAt,c.userId,c.redeemedAt,c.grantedUntil,u.username,
    CASE WHEN c.userId IS NOT NULL THEN 'used' WHEN c.revokedAt IS NOT NULL THEN 'revoked' WHEN c.redeemBefore<>0 AND c.redeemBefore<=? THEN 'expired' ELSE 'unused' END AS state
    FROM authorization_code c LEFT JOIN user u ON u.id=c.userId`;
  const totals = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(userId IS NOT NULL),0) AS used,
    COALESCE(SUM(userId IS NULL AND revokedAt IS NOT NULL),0) AS revoked,
    COALESCE(SUM(userId IS NULL AND revokedAt IS NULL AND redeemBefore<>0 AND redeemBefore<=?),0) AS expired,
    COALESCE(SUM(userId IS NULL AND revokedAt IS NULL AND (redeemBefore=0 OR redeemBefore>?)),0) AS unused FROM authorization_code`).get(now, now);
  if (id) {
    const item = db.prepare(query + ' WHERE c.id=?').get(now, id) as Record<string, unknown> | undefined;
    if (!item) throw new LicenseError('授权码不存在', 404);
    const { encrypted } = db.prepare('SELECT encrypted FROM authorization_code WHERE id=?').get(id) as { encrypted: string };
    return { ...item, code: unseal(db, id, encrypted), access: item.userId ? accountAccess(db, String(item.userId), now) : null };
  }
  return { totals, items: db.prepare(query + ' ORDER BY c.createdAt DESC,c.id LIMIT 50 OFFSET ?').all(now, offset), offset, limit: 50 };
}
export function revokeLicense(db: Database.Database, id: unknown, now = Date.now()) {
  if (typeof id !== 'string') throw new LicenseError('授权码编号无效');
  const result = db.prepare('UPDATE authorization_code SET revokedAt=? WHERE id=? AND userId IS NULL AND revokedAt IS NULL').run(now, id);
  if (!result.changes) throw new LicenseError('仅能作废尚未使用的授权码');
}
