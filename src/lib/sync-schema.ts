import type Database from 'better-sqlite3';

export function initializeSyncSchema(database: Database.Database) {
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
      version INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      mutationId TEXT NOT NULL,
      PRIMARY KEY (userId, collection, key)
    );
    CREATE INDEX IF NOT EXISTS user_sync_changes ON user_sync_data(userId, version);
  `);
}
