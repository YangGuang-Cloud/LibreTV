import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { hashPassword } from 'better-auth/crypto';
import { initializePasswordVault, passwordVaultKey, sealManagedPassword, writeManagedPassword, readManagedPassword, captureManagedPassword } from './account-password-vault';
let database: Database.Database;
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-password-vault-'));
  vi.stubEnv('SERVER_DATA_DIR', directory);
  database = new Database(':memory:');
  database.exec("CREATE TABLE user(id TEXT PRIMARY KEY); CREATE TABLE account(userId TEXT,providerId TEXT,password TEXT); INSERT INTO user VALUES ('a'),('b'); INSERT INTO account VALUES ('a','credential','hash-a'),('b','credential','hash-b')");
  initializePasswordVault(database);
});
afterEach(() => { database.close(); vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });
it('独立随机密钥保持稳定、权限 0600，密文使用随机 nonce', () => {
  const key = passwordVaultKey(database, true);
  const sealed = sealManagedPassword(key, 'a', 'hash-a', 'test-password');
  writeManagedPassword(database, sealed);
  expect(passwordVaultKey(database, true)).toEqual(key);
  expect(readManagedPassword(database, 'a')).toBe('test-password');
  expect(JSON.stringify(sealed)).not.toContain('test-password');
  expect(sealManagedPassword(key, 'a', 'hash-a', 'test-password').ciphertext).not.toBe(sealed.ciphertext);
  expect(fs.statSync(path.join(directory, '.account-password.key')).mode & 0o777).toBe(0o600);
  vi.stubEnv('BETTER_AUTH_SECRET', 'rotated-login-secret');
  expect(readManagedPassword(database, 'a')).toBe('test-password');
});
it('篡改密文、交换账号和错误密钥都无法解密', () => {
  const key = passwordVaultKey(database, true);
  const sealed = sealManagedPassword(key, 'a', 'hash-a', 'test-password');
  writeManagedPassword(database, { ...sealed, userId: 'b', passwordHash: 'hash-b' });
  expect(() => readManagedPassword(database, 'b')).toThrow();
  writeManagedPassword(database, { ...sealed, tag: Buffer.alloc(16).toString('base64') });
  expect(() => readManagedPassword(database, 'a')).toThrow();
  writeManagedPassword(database, sealed);
  vi.stubEnv('ACCOUNT_PASSWORD_KEY', 'ab'.repeat(32));
  expect(() => readManagedPassword(database, 'a')).toThrow();
});
it('旧副本不匹配当前登录哈希时不可查看；丢失密钥后不重新生成替代密钥', () => {
  const key = passwordVaultKey(database, true);
  writeManagedPassword(database, sealManagedPassword(key, 'a', 'hash-a', 'test-password'));
  database.prepare('UPDATE account SET password=? WHERE userId=?').run('new-hash', 'a');
  expect(readManagedPassword(database, 'a')).toBeNull();
  fs.unlinkSync(path.join(directory, '.account-password.key'));
  expect(() => passwordVaultKey(database, true)).toThrow('丢失');
  expect(fs.existsSync(path.join(directory, '.account-password.key'))).toBe(false);
});
it('并发密码变更后，迟到的捕获不能覆盖最新记录', async () => {
  const key = passwordVaultKey(database, true);
  const hash = await hashPassword('initial-password');
  database.prepare('UPDATE account SET password=? WHERE userId=?').run(hash, 'a');
  const capture = captureManagedPassword(database, key, 'a', 'initial-password');
  database.prepare('UPDATE account SET password=? WHERE userId=?').run('newer-hash', 'a');
  expect(await capture).toBe(false);
  expect(database.prepare('SELECT COUNT(*) AS count FROM managed_password').get()).toEqual({ count: 0 });
});
it('可使用独立环境密钥，配置无效时不会悄悄回退', () => {
  vi.stubEnv('ACCOUNT_PASSWORD_KEY', '12'.repeat(32));
  expect(passwordVaultKey(database, true)).toEqual(Buffer.from('12'.repeat(32), 'hex'));
  expect(fs.existsSync(path.join(directory, '.account-password.key'))).toBe(false);
  vi.stubEnv('ACCOUNT_PASSWORD_KEY', 'invalid');
  expect(() => passwordVaultKey(database, true)).toThrow('无效');
});
