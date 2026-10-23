import { accountAccess } from './account-licenses';
import { hashPassword } from 'better-auth/crypto';
import { passwordVaultKey, captureManagedPassword, sealManagedPassword, writeManagedPassword, readManagedPassword } from './account-password-vault';
import { getAccountAuth } from './account-auth';

export class AccountInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function managedPasswordKey(database: Parameters<typeof passwordVaultKey>[0]) {
  try { return passwordVaultKey(database, true); }
  catch { throw new AccountInputError('密码加密存储不可用，请检查服务器密钥或恢复密钥备份', 503); }
}

export function validUsername(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(value.trim())) throw new AccountInputError('账号需为 3–32 位字母、数字或下划线');
  return value.trim().toLowerCase();
}

export function validPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128) throw new AccountInputError('密码长度需为 6–128 位');
  return value;
}

export interface ManagedUser {
  id: string;
  username: string;
  name: string;
  banned: number;
  createdAt: number;
  passwordAvailable: boolean;
  access?: import('./account-licenses').AccountAccess;
}

export async function listAccountUsers(offset = 0) {
  const { database } = await getAccountAuth();
  const rows = database.prepare(`SELECT id, username, name, COALESCE(banned, 0) AS banned, createdAt,
    EXISTS(SELECT 1 FROM managed_password vault JOIN account credential
      ON credential.userId=vault.userId AND credential.providerId='credential' AND credential.password=vault.passwordHash
      WHERE vault.userId=user.id) AS passwordAvailable
    FROM user ORDER BY createdAt DESC, id LIMIT 50 OFFSET ?`).all(offset) as (Omit<ManagedUser, 'passwordAvailable'> & { passwordAvailable: number })[];
  const users: ManagedUser[] = rows.map((row) => ({ ...row, access: accountAccess(database, row.id), passwordAvailable: row.passwordAvailable === 1 }));
  const { total } = database.prepare('SELECT COUNT(*) AS total FROM user').get() as { total: number };
  return { users, total, offset, limit: 50 };
}

export async function createAccountUser(body: Record<string, unknown>) {
  const login = validUsername(body.username);
  const password = validPassword(body.password);
  const name = typeof body.name === 'string' ? body.name.trim() : login;
  if (!name || name.length > 80) throw new AccountInputError('显示名称需为 1–80 个字符');
  const { auth, database } = await getAccountAuth();
  if (database.prepare('SELECT id FROM user WHERE username = ?').get(login)) throw new AccountInputError('该账号已存在', 409);
  const key = managedPasswordKey(database);
  // 框架要求 email；站内账号使用保留的 .invalid 域名，不收集或发送邮件。
  const created = await auth.api.createUser({ body: {
    email: `${login}@accounts.invalid`, password, name, role: 'user',
    data: { username: login, displayUsername: login },
  } });
  if (!await captureManagedPassword(database, key, created.user.id, password)) throw new AccountInputError('账号已创建，但密码已发生变更，请刷新列表', 409);
}

export async function updateAccountUser(body: Record<string, unknown>) {
  if (typeof body.userId !== 'string' || body.userId.length > 128) throw new AccountInputError('账号编号无效');
  const { database } = await getAccountAuth();
  const user = database.prepare('SELECT id FROM user WHERE id = ?').get(body.userId);
  if (!user) throw new AccountInputError('账号不存在', 404);
  if (body.action === 'reset-password') {
    const plaintext = validPassword(body.password);
    const key = managedPasswordKey(database);
    const password = await hashPassword(plaintext);
    const encrypted = sealManagedPassword(key, body.userId, password, plaintext);
    database.transaction(() => {
      const result = database.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").run(password, Date.now(), body.userId);
      if (result.changes !== 1) throw new Error('账号密码记录异常');
      writeManagedPassword(database, encrypted);
      database.prepare('DELETE FROM session WHERE userId = ?').run(body.userId);
    })();
  } else if (body.action === 'disable' || body.action === 'enable') {
    database.transaction(() => {
      database.prepare('UPDATE user SET banned = ?, banReason = ?, banExpires = NULL, updatedAt = ? WHERE id = ?')
        .run(body.action === 'disable' ? 1 : 0, body.action === 'disable' ? '管理员已停用此账号' : null, Date.now(), body.userId);
      database.prepare('DELETE FROM session WHERE userId = ?').run(body.userId);
    })();
  } else throw new AccountInputError('操作无效');
}

export async function revealAccountPassword(userId: unknown): Promise<string> {
  if (typeof userId !== 'string' || !userId || userId.length > 128) throw new AccountInputError('账号编号无效');
  const { database } = await getAccountAuth();
  if (!database.prepare('SELECT id FROM user WHERE id=?').get(userId)) throw new AccountInputError('账号不存在', 404);
  try {
    const password = readManagedPassword(database, userId);
    if (password === null) throw new AccountInputError('该密码尚无可查看记录，请重置后再查看', 409);
    return password;
  } catch (error) {
    if (error instanceof AccountInputError) throw error;
    throw new AccountInputError('密码记录无法解密，请检查服务器密钥或恢复密钥备份', 503);
  }
}
