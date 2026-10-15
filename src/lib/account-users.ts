import { hashPassword } from 'better-auth/crypto';
import { getAccountAuth } from './account-auth';

export class AccountInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function validUsername(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(value.trim())) throw new AccountInputError('账号需为 3–32 位字母、数字或下划线');
  return value.trim().toLowerCase();
}

export function validPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw new AccountInputError('密码长度需为 10–128 位');
  return value;
}

export interface ManagedUser {
  id: string;
  username: string;
  name: string;
  banned: number;
  createdAt: number;
}

export async function listAccountUsers(offset = 0) {
  const { database } = await getAccountAuth();
  const users = database.prepare('SELECT id, username, name, COALESCE(banned, 0) AS banned, createdAt FROM user ORDER BY createdAt DESC, id LIMIT 50 OFFSET ?').all(offset) as ManagedUser[];
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
  // 框架要求 email；站内账号使用保留的 .invalid 域名，不收集或发送邮件。
  await auth.api.createUser({ body: {
    email: `${login}@accounts.invalid`, password, name, role: 'user',
    data: { username: login, displayUsername: login },
  } });
}

export async function updateAccountUser(body: Record<string, unknown>) {
  if (typeof body.userId !== 'string' || body.userId.length > 128) throw new AccountInputError('账号编号无效');
  const { database } = await getAccountAuth();
  const user = database.prepare('SELECT id FROM user WHERE id = ?').get(body.userId);
  if (!user) throw new AccountInputError('账号不存在', 404);
  if (body.action === 'reset-password') {
    const password = await hashPassword(validPassword(body.password));
    database.transaction(() => {
      const result = database.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").run(password, Date.now(), body.userId);
      if (result.changes !== 1) throw new Error('账号密码记录异常');
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
