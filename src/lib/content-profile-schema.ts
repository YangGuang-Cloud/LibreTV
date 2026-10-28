import type Database from 'better-sqlite3';
export function initializeContentProfiles(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS content_profile(id TEXT PRIMARY KEY,name TEXT NOT NULL,sources TEXT NOT NULL,recommendations TEXT NOT NULL,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_content_profile(userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,profileId TEXT NOT NULL REFERENCES content_profile(id));
    CREATE INDEX IF NOT EXISTS account_content_profile_profile ON account_content_profile(profileId);`);
}
