import { isPasswordConfigured, sessionFromCookieHeader } from './auth';
import { accountConfigured, accountMode } from './account-mode';

export function viewerConfigured(): boolean {
  return accountMode() ? accountConfigured() : isPasswordConfigured();
}

export async function viewerSession(req: Request): Promise<boolean> {
  if (!viewerConfigured()) return false;
  if (!accountMode()) return sessionFromCookieHeader(req.headers.get('cookie'));
  const { getAccountSession } = await import('./account-auth');
  return !!await getAccountSession(req.headers);
}
