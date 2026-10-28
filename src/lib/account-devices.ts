import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { secureCookie } from './admin-auth';
export const DEVICE_COOKIE = 'ltv_device';
export class DeviceError extends Error { constructor(message: string, public status = 403) { super(message); } }
export function initializeDevices(db: Database.Database) {
  db.transaction(() => {
    const existed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_device'").get();
    db.exec(`CREATE TABLE IF NOT EXISTS account_device_limit(userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, maximum INTEGER NOT NULL CHECK(maximum BETWEEN 1 AND 50));
      CREATE TABLE IF NOT EXISTS account_device(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,
        createdAt INTEGER NOT NULL,lastLoginAt INTEGER NOT NULL,lastSeenAt INTEGER NOT NULL,userAgent TEXT,ipAddress TEXT,UNIQUE(userId,fingerprint));
      CREATE TABLE IF NOT EXISTS account_device_session(sessionId TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
        deviceId TEXT NOT NULL REFERENCES account_device(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS account_device_session_device ON account_device_session(deviceId);
      CREATE INDEX IF NOT EXISTS account_device_history ON account_device(userId,lastLoginAt DESC,id);`);
    // Legacy sessions have no trustworthy installation/browser identity. Keep all account data.
    if (!existed) db.exec('DELETE FROM session');
  }).immediate();
}
const valid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function cookieIdentity(headers: Headers) {
  for (const entry of (headers.get('cookie') || '').split(';')) {
    const i = entry.indexOf('='); if (entry.slice(0, i).trim() === DEVICE_COOKIE) return entry.slice(i + 1).trim();
  }
  return null;
}
export function requestDevice(headers: Headers, create = false) {
  const native = headers.get('x-luna-device-id'), browser = cookieIdentity(headers);
  if (!native && /^Luna12TV\/.*\(iOS /.test(headers.get('user-agent') || '')) throw new DeviceError('请更新 iOS 客户端后登录，以启用登录设备管理', 426);
  const value = native ?? browser;
  if (value !== null && !valid(value)) { if (native) throw new DeviceError('设备编号无效，请更新客户端', 400); return create ? crypto.randomUUID() : null; }
  return value?.toLowerCase() ?? (create ? crypto.randomUUID() : null);
}
const fingerprint = (value: string) => crypto.createHash('sha256').update(`luna-device:v1:${value}`).digest('hex');
const sessionDeadline = `(CASE WHEN typeof(s.expiresAt) IN ('integer','real') THEN s.expiresAt ELSE (julianday(s.expiresAt)-2440587.5)*86400000 END)`;
function loggedInCount(db: Database.Database, userId: string, now = Date.now()) {
  return (db.prepare(`SELECT COUNT(DISTINCT d.id) AS n FROM account_device d
    JOIN account_device_session ds ON ds.deviceId=d.id JOIN session s ON s.id=ds.sessionId AND s.userId=d.userId
    WHERE d.userId=? AND ${sessionDeadline}>?`).get(userId, now) as { n: number }).n;
}
export function logoutDevice(db: Database.Database, userId: string, deviceId: string) {
  db.prepare(`DELETE FROM session WHERE userId=? AND id IN
    (SELECT sessionId FROM account_device_session WHERE deviceId=?)`).run(userId, deviceId);
}
export function logoutSessionDevice(db: Database.Database, sessionId: string, userId: string) {
  const row = db.prepare(`SELECT d.id FROM account_device d JOIN account_device_session ds ON ds.deviceId=d.id
    WHERE ds.sessionId=? AND d.userId=?`).get(sessionId, userId) as { id: string } | undefined;
  if (row) logoutDevice(db, userId, row.id);
}
export function bindDevice(db: Database.Database, req: Request, userId: string, sessionId: string, identity: string, now = Date.now()) {
  return db.transaction(() => {
    if (!db.prepare('SELECT id FROM session WHERE id=? AND userId=?').get(sessionId, userId)) throw new DeviceError('登录会话已失效，请重新登录', 401);
    const hash = fingerprint(identity);
    const existing = db.prepare('SELECT id FROM account_device WHERE userId=? AND fingerprint=?').get(userId, hash) as { id: string } | undefined;
    const maximum = (db.prepare('SELECT maximum FROM account_device_limit WHERE userId=?').get(userId) as { maximum: number } | undefined)?.maximum ?? 3;
    const count = loggedInCount(db, userId, now);
    const alreadyLoggedIn = existing && db.prepare(`SELECT 1 FROM account_device_session ds JOIN session s ON s.id=ds.sessionId
      WHERE ds.deviceId=? AND s.userId=? AND ${sessionDeadline}>?`).get(existing.id, userId, now);
    if (!alreadyLoggedIn && count >= maximum) throw new DeviceError(`此账号最多同时登录 ${maximum} 台设备，请先在其他设备退出账号，或联系管理员退出设备`);
    const id = existing?.id ?? crypto.randomUUID();
    const agent = req.headers.get('user-agent')?.slice(0, 2048) ?? null;
    const ip = (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '').slice(0, 128) || null;
    if (!existing) db.prepare('INSERT INTO account_device VALUES(?,?,?,?,?,?,?,?)').run(id, userId, hash, now, now, now, agent, ip);
    else db.prepare('UPDATE account_device SET lastLoginAt=?,lastSeenAt=?,userAgent=?,ipAddress=? WHERE id=?').run(now, now, agent, ip, id);
    db.prepare('INSERT INTO account_device_session(sessionId,deviceId) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET deviceId=excluded.deviceId').run(sessionId, id);
    // A renewed login replaces previous sessions on this same device, so one logout releases its slot.
    db.prepare('DELETE FROM session WHERE userId=? AND id<>? AND id IN (SELECT sessionId FROM account_device_session WHERE deviceId=?)').run(userId, sessionId, id);
    return id;
  }).immediate();
}
export function deviceSessionAllowed(db: Database.Database, headers: Headers, sessionId: string, userId: string, now = Date.now()) {
  let identity; try { identity = requestDevice(headers); } catch { return false; }
  if (!identity) return false;
  const row = db.prepare('SELECT d.id FROM account_device d JOIN account_device_session s ON s.deviceId=d.id WHERE s.sessionId=? AND d.userId=? AND d.fingerprint=?').get(sessionId, userId, fingerprint(identity)) as { id: string } | undefined;
  if (!row) return false;
  db.prepare('UPDATE account_device SET lastSeenAt=? WHERE id=? AND lastSeenAt<?').run(now, row.id, now - 60_000);
  return true;
}
export function setDeviceCookie(response: Response, req: Request, identity: string) {
  if (req.headers.has('x-luna-device-id')) return;
  response.headers.append('set-cookie', `${DEVICE_COOKIE}=${identity}; Path=/api; Max-Age=31536000; HttpOnly; SameSite=Lax${secureCookie(req) ? '; Secure' : ''}`);
}
export function readDevices(db: Database.Database, userId: string, now = Date.now()) {
  const maximum = (db.prepare('SELECT maximum FROM account_device_limit WHERE userId=?').get(userId) as { maximum: number } | undefined)?.maximum ?? 3;
  const items = db.prepare(`SELECT d.id,d.createdAt,d.lastLoginAt,d.lastSeenAt,d.userAgent,d.ipAddress,
    (SELECT COUNT(*) FROM account_device_session ds JOIN session s ON s.id=ds.sessionId WHERE ds.deviceId=d.id AND
    (CASE WHEN typeof(s.expiresAt) IN ('integer','real') THEN s.expiresAt ELSE (julianday(s.expiresAt)-2440587.5)*86400000 END)>?) AS sessions
    FROM account_device d WHERE d.userId=? AND EXISTS(SELECT 1 FROM account_device_session ds JOIN session s ON s.id=ds.sessionId AND s.userId=d.userId WHERE ds.deviceId=d.id AND ${sessionDeadline}>?) ORDER BY d.lastSeenAt DESC,d.id`).all(now, userId, now);
  return { maximum, total: items.length, items };
}
export function readDeviceHistory(db: Database.Database, userId: string, offset = 0, now = Date.now()) {
  const limit = 50;
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM account_device WHERE userId=?').get(userId) as { total: number };
  const items = db.prepare(`SELECT d.id,d.createdAt,d.lastLoginAt,d.lastSeenAt,d.userAgent,d.ipAddress,
    (SELECT COUNT(*) FROM account_device_session ds JOIN session s ON s.id=ds.sessionId AND s.userId=d.userId
    WHERE ds.deviceId=d.id AND ${sessionDeadline}>?) AS sessions
    FROM account_device d WHERE d.userId=? ORDER BY d.lastLoginAt DESC,d.id LIMIT ? OFFSET ?`).all(now, userId, limit, offset);
  return { total, items, offset, limit };
}
export function manageDevice(db: Database.Database, userId: unknown, body: Record<string, unknown>) {
  if (typeof userId !== 'string' || !db.prepare('SELECT id FROM user WHERE id=?').get(userId)) throw new DeviceError('账号不存在', 404);
  db.transaction(() => {
    if (body.action === 'set-limit') {
      const n = body.maximum;
      if (!Number.isInteger(n) || Number(n) < 1 || Number(n) > 50) throw new DeviceError('设备上限需为 1–50 台', 400);
      const count = loggedInCount(db, userId);
      if (Number(n) < count) throw new DeviceError(`当前已有 ${count} 台设备登录，请先退出多余设备再降低上限`, 409);
      db.prepare('INSERT INTO account_device_limit VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET maximum=excluded.maximum').run(userId, n);
    } else if (body.action === 'logout-device' && typeof body.deviceId === 'string') {
      if (!db.prepare('SELECT id FROM account_device WHERE id=? AND userId=?').get(body.deviceId, userId)) throw new DeviceError('设备不存在', 404);
      logoutDevice(db, userId, body.deviceId);
    } else throw new DeviceError('操作无效', 400);
  }).immediate();
}
