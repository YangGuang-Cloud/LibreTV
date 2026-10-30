import type { AccountActivity } from './account-activity';
import type { SyncCollection } from './sync-model';

export interface AdminAccountUser {
  id: string; username: string; name: string; banned: number;
  createdAt: number; updatedAt: number; passwordAvailable: boolean;
}
export type AdminAccountSection = SyncCollection | 'sessions';
export interface AdminAccountRecord {
  key: string; value: unknown; deleted: boolean; deletedAt: number | null;
  updatedAt: number; version: number; title?: string;
}
export interface AdminAccountSession {
  createdAt: number; updatedAt: number; expiresAt: number;
  ipAddress: string | null; userAgent: string | null;
}
export interface AdminAccountDetail {
  user: AdminAccountUser;
  counts: Record<SyncCollection, { total: number; deleted: number }>;
  activeSessions: number;
  lastLoginAt: number | null;
  activity: AccountActivity;
  authorization: import('./account-licenses').AccountAccess;
  section: AdminAccountSection;
  records: AdminAccountRecord[];
  sessions: AdminAccountSession[];
  total: number; offset: number; limit: number;
}
