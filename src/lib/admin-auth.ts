import crypto from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'ltv_admin_session';
const TTL_MS = 8 * 60 * 60 * 1000;
export const ADMIN_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export const adminUsername = () => process.env.ADMIN_USERNAME?.trim() || 'admin';

export function adminPasswordConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

function signature(payload: string): string {
  const credentials = ['libretv:admin', process.env.PROXY_SECRET || process.env.PASSWORD || '', process.env.ADMIN_PASSWORD || ''];
  // Preserve existing sessions for the default account; changing its name revokes them.
  if (adminUsername() !== 'admin') credentials.push(adminUsername());
  const key = crypto.createHash('sha256').update(JSON.stringify(credentials)).digest();
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

export function checkAdminPassword(input: string): boolean {
  if (!adminPasswordConfigured()) return false;
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(input), digest(process.env.ADMIN_PASSWORD!));
}

export function signAdminSession(remember = false): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + (remember ? ADMIN_REMEMBER_MS : TTL_MS);
  const payload = `${remember ? 'r.' : ''}${expiresAt}`;
  return { token: `${payload}.${signature(payload)}`, expiresAt };
}

function readAdminSession(token: string) {
  if (!adminPasswordConfigured() || !/^(?:r\.)?\d{13}\.[a-f0-9]{64}$/.test(token)) return null;
  const split = token.lastIndexOf('.');
  const payload = token.slice(0, split), signed = token.slice(split + 1);
  const remember = payload.startsWith('r.');
  const expiresAt = Number(remember ? payload.slice(2) : payload);
  if (expiresAt <= Date.now() || !crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(signature(payload)))) return null;
  return { username: adminUsername(), remember, expiresAt };
}
export function verifyAdminSession(token: string): boolean { return !!readAdminSession(token); }

export function adminSessionDetails(req: Request) {
  for (const entry of (req.headers.get('cookie') || '').split(';')) {
    const index = entry.indexOf('=');
    if (entry.slice(0, index).trim() !== ADMIN_SESSION_COOKIE) continue;
    try { return readAdminSession(decodeURIComponent(entry.slice(index + 1).trim())); }
    catch { return null; }
  }
  return null;
}
export function adminSessionFromRequest(req: Request): boolean { return !!adminSessionDetails(req); }

export function secureCookie(req: Request): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}
