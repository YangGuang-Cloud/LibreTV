import crypto from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'ltv_admin_session';
const TTL_MS = 8 * 60 * 60 * 1000;

export function adminPasswordConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

function signature(payload: string): string {
  const key = crypto.createHash('sha256').update(JSON.stringify([
    'libretv:admin', process.env.PROXY_SECRET || process.env.PASSWORD || '', process.env.ADMIN_PASSWORD || '',
  ])).digest();
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

export function checkAdminPassword(input: string): boolean {
  if (!adminPasswordConfigured()) return false;
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(input), digest(process.env.ADMIN_PASSWORD!));
}

export function signAdminSession(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TTL_MS;
  const payload = String(expiresAt);
  return { token: `${payload}.${signature(payload)}`, expiresAt };
}

export function verifyAdminSession(token: string): boolean {
  if (!adminPasswordConfigured() || !/^\d{13}\.[a-f0-9]{64}$/.test(token)) return false;
  const [payload, signed] = token.split('.');
  return Number(payload) > Date.now() && crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(signature(payload)));
}

export function adminSessionFromRequest(req: Request): boolean {
  for (const entry of (req.headers.get('cookie') || '').split(';')) {
    const index = entry.indexOf('=');
    if (entry.slice(0, index).trim() !== ADMIN_SESSION_COOKIE) continue;
    try { return verifyAdminSession(decodeURIComponent(entry.slice(index + 1).trim())); }
    catch { return false; }
  }
  return false;
}

export function secureCookie(req: Request): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}
