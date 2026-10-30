import type Database from 'better-sqlite3';
import { AccountInputError } from './account-users';

/** Administrator-only permanent removal, including records already hidden by clients. */
export function deleteAccountSearchRecord(database: Database.Database, input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountInputError('请求格式无效');
  const { userId, key, version } = input as Record<string, unknown>;
  if (typeof userId !== 'string' || !userId || userId.length > 128 || typeof key !== 'string' || !key || key.length > 4096 || !Number.isSafeInteger(version) || (version as number) < 1 || (version as number) > 1e15) throw new AccountInputError('账号、记录编号或版本无效');
  database.transaction(() => {
    if (!database.prepare('SELECT id FROM user WHERE id=?').get(userId)) throw new AccountInputError('账号不存在', 404);
    const row = database.prepare("SELECT version FROM user_sync_data WHERE userId=? AND collection='search' AND key=?").get(userId, key) as { version: number } | undefined;
    if (!row) return; // Retrying a completed deletion is safe.
    if (row.version !== version) throw new AccountInputError('此搜索记录已有更新，请刷新后重试', 409);
    database.prepare("DELETE FROM user_sync_data WHERE userId=? AND collection='search' AND key=?").run(userId, key);
  }).immediate();
}
