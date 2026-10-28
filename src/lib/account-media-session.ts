import { getAccountAuth } from './account-auth';
import { accountAccess } from './account-licenses';
/** AirPlay receivers use the signed link without cookies; its issuing session must still exist. */
export async function mediaSessionAllowed(id: string | null, now = Date.now()) {
  if (!id || !/^[\w-]{1,128}$/.test(id)) return false;
  const { database } = await getAccountAuth();
  const row = database.prepare(`SELECT s.userId FROM session s JOIN user u ON u.id=s.userId
    JOIN account_device_session ds ON ds.sessionId=s.id JOIN account_device d ON d.id=ds.deviceId AND d.userId=s.userId
    WHERE s.id=? AND COALESCE(u.banned,0)=0 AND
    (CASE WHEN typeof(s.expiresAt) IN ('integer','real') THEN s.expiresAt ELSE (julianday(s.expiresAt)-2440587.5)*86400000 END)>?`).get(id, now) as { userId: string } | undefined;
  return !!row && accountAccess(database, row.userId, now).state === 'active';
}
