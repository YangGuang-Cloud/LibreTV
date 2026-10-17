import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { verifyPassword } from 'better-auth/crypto';

export function initializePasswordVault(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS managed_password (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    passwordHash TEXT NOT NULL,
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    tag TEXT NOT NULL,
    updatedAt INTEGER NOT NULL
  )`);
}
function vaultPath() {
  return path.join(path.resolve(process.env.SERVER_DATA_DIR || path.join(process.cwd(), '.data')), '.account-password.key');
}
/** 与登录签名密钥分离；发布和会话密钥轮换均不改变密码加密密钥。 */
export function passwordVaultKey(database: Database.Database, create = false): Buffer {
  const configured = process.env.ACCOUNT_PASSWORD_KEY;
  if (configured !== undefined) {
    if (!/^[a-fA-F0-9]{64}$/.test(configured)) throw new Error('密码加密密钥配置无效');
    return Buffer.from(configured, 'hex');
  }
  const target = vaultPath();
  let key: Buffer;
  try { key = fs.readFileSync(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw new Error('密码加密密钥不可用');
    const { count } = database.prepare('SELECT COUNT(*) AS count FROM managed_password').get() as { count: number };
    if (count) throw new Error('密码加密密钥丢失，请恢复密钥备份');
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, randomBytes(32), { flag: 'wx', mode: 0o600 });
      try { fs.linkSync(temp, target); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }
    } finally { try { fs.unlinkSync(temp); } catch { /* no temporary key remains after a successful write */ } }
    key = fs.readFileSync(target);
  }
  if (key.length !== 32) throw new Error('密码加密密钥损坏');
  fs.chmodSync(target, 0o600);
  return key;
}
interface PasswordEnvelope { userId: string; passwordHash: string; iv: string; ciphertext: string; tag: string; updatedAt: number }
export function sealManagedPassword(key: Buffer, userId: string, passwordHash: string, password: string): PasswordEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(['Luna12TV.password.v1', userId, passwordHash])));
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return { userId, passwordHash, iv: iv.toString('base64'), ciphertext: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64'), updatedAt: Date.now() };
}
export function writeManagedPassword(database: Database.Database, value: PasswordEnvelope) {
  database.prepare(`INSERT INTO managed_password (userId,passwordHash,iv,ciphertext,tag,updatedAt)
    VALUES (@userId,@passwordHash,@iv,@ciphertext,@tag,@updatedAt)
    ON CONFLICT(userId) DO UPDATE SET passwordHash=excluded.passwordHash,iv=excluded.iv,ciphertext=excluded.ciphertext,tag=excluded.tag,updatedAt=excluded.updatedAt`).run(value);
}
/** Hash binding prevents a concurrent or unsupported password change from exposing a stale password. */
export async function captureManagedPassword(database: Database.Database, key: Buffer, userId: string, password: string): Promise<boolean> {
  const row = database.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").get(userId) as { password: string } | undefined;
  if (!row?.password || !await verifyPassword({ hash: row.password, password })) return false;
  const envelope = sealManagedPassword(key, userId, row.password, password);
  return database.transaction(() => {
    const current = database.prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'").get(userId) as { password: string } | undefined;
    if (current?.password !== row.password) return false;
    writeManagedPassword(database, envelope);
    return true;
  })();
}
export function readManagedPassword(database: Database.Database, userId: string): string | null {
  const row = database.prepare(`SELECT vault.* FROM managed_password vault JOIN account credential
    ON credential.userId=vault.userId AND credential.providerId='credential' AND credential.password=vault.passwordHash
    WHERE vault.userId=?`).get(userId) as PasswordEnvelope | undefined;
  if (!row) return null;
  const decipher = createDecipheriv('aes-256-gcm', passwordVaultKey(database), Buffer.from(row.iv, 'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify(['Luna12TV.password.v1', row.userId, row.passwordHash])));
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
