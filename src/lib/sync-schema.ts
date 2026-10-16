import type Database from 'better-sqlite3';

export function initializeSyncSchema(database: Database.Database) {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS user_sync_state (
        userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS user_sync_data (
        userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        collection TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        deletedAt INTEGER,
        version INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        mutationId TEXT NOT NULL,
        PRIMARY KEY (userId, collection, key)
      );
      CREATE INDEX IF NOT EXISTS user_sync_changes ON user_sync_data(userId, version);
    `);
    const columns = database.pragma('table_info(user_sync_data)') as { name: string }[];
    if (!columns.some((column) => column.name === 'deleted')) database.exec('ALTER TABLE user_sync_data ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
    if (!columns.some((column) => column.name === 'deletedAt')) database.exec('ALTER TABLE user_sync_data ADD COLUMN deletedAt INTEGER');
    // 旧版墓碑已经丢失原值；保持删除状态，不让升级后重新出现在客户端。
    database.exec(`
      UPDATE user_sync_data SET deleted = 1, deletedAt = COALESCE(deletedAt, updatedAt) WHERE value IS NULL AND deleted = 0;
      CREATE INDEX IF NOT EXISTS user_sync_active ON user_sync_data(userId, collection, deleted);
    `);
  })();
}
