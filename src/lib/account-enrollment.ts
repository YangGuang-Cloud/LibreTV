import crypto from 'node:crypto';
import { bindDevice, requestDevice, setDeviceCookie, DeviceError } from './account-devices';
import { recordAccountLogin } from './account-login-state';
import { hashPassword } from 'better-auth/crypto';
import { getAccountAuth, accountAuthHandler, getAccountSession, getAccountIdentity } from './account-auth';
import { validUsername, existingUsername, validPassword, AccountInputError } from './account-users';
import { LicenseError, redeemLicense } from './account-licenses';
import { passwordVaultKey, sealManagedPassword, writeManagedPassword } from './account-password-vault';
import { checkRateLimit, clearRateLimit } from './auth';
import { accountMode, accountConfigured } from './account-mode';
export async function enrollmentRequest(req: Request, kind: 'register' | 'redeem') {
  const headers = { 'Cache-Control': 'private, no-store' };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (!accountMode() || !accountConfigured()) return reply({ error: '账号系统尚未配置' }, 503);
  const origin = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== new URL(process.env.BETTER_AUTH_URL!).origin) return reply({ error: '请求来源无效' }, 403);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const key = `enroll:${ip}`;
  if (!checkRateLimit(key)) return reply({ error: '操作频繁，请稍后再试' }, 429);
  try {
    if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: '请使用 JSON 请求' }, 415);
    const raw = await req.text(); if (raw.length > 4096) return reply({ error: '请求过大' }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
    catch { return reply({ error: '请求格式无效' }, 400); }
    const { database } = await getAccountAuth();
    if (kind === 'register') {
      const username = validUsername(body.username), password = validPassword(body.password);
      const name = typeof body.name === 'string' ? body.name.trim() : username;
      if (!name || name.length > 80) throw new AccountInputError('显示名称需为 1–80 个字符');
      const passwordHash = await hashPassword(password), userId = crypto.randomUUID(), now = Date.now();
      const encrypted = sealManagedPassword(passwordVaultKey(database, true), userId, passwordHash, password);
      database.transaction(() => {
        if (database.prepare('SELECT id FROM user WHERE username=? OR email=?').get(username, `${username}@accounts.invalid`)) throw new LicenseError('该账号已存在', 409);
        database.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername,role,banned) VALUES(?,?,?,0,?,?,?,?,?,0)')
          .run(userId, name, `${username}@accounts.invalid`, now, now, username, username, 'user');
        database.prepare('INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)')
          .run(crypto.randomUUID(), userId, 'credential', userId, passwordHash, now, now);
        redeemLicense(database, userId, body.code, now);
        writeManagedPassword(database, encrypted);
      }).immediate();
      clearRateLimit(key);
      return reply({ success: true });
    }
    let session = await getAccountSession(req.headers, true);
    if (session && typeof body.username === 'string' && existingUsername(body.username) !== session.user.username) throw new LicenseError('与当前登录账号不一致，请先退出账号');
    let loginResponse: Response | null = null;
    if (!session) {
      const username = existingUsername(body.username), password = validPassword(body.password);
      const loginHeaders = new Headers(req.headers); loginHeaders.set('content-type', 'application/json'); loginHeaders.delete('content-length');
      loginResponse = await accountAuthHandler(new Request(new URL('/api/auth/sign-in/username', process.env.BETTER_AUTH_URL), { method: 'POST', headers: loginHeaders, body: JSON.stringify({ username, password }) }));
      if (loginResponse.status === 429) return loginResponse;
      if (!loginResponse.ok) return reply({ error: '账号或密码错误，或账号已停用' }, 401);
      const sessionHeaders = new Headers(req.headers);
      sessionHeaders.set('cookie', loginResponse.headers.getSetCookie().map((value) => value.split(';')[0]).join('; '));
      session = await getAccountIdentity(sessionHeaders);
    }
    if (!session) return reply({ error: '请重新验证账号与密码' }, 401);
    let access;
    const identity = requestDevice(req.headers, true)!;
    try { access = database.transaction(() => {
      bindDevice(database, req, session!.user.id, session!.session.id, identity);
      return redeemLicense(database, session!.user.id, body.code);
    }).immediate(); }
    catch (error) {
      // Failed credential-based renewal must not leave an unused authenticated session behind.
      if (loginResponse) database.prepare('DELETE FROM session WHERE id=?').run(session.session.id);
      throw error;
    }
    const response = reply({ success: true, access });
    if (loginResponse) for (const cookie of loginResponse.headers.getSetCookie()) response.headers.append('set-cookie', cookie);
    setDeviceCookie(response, req, identity);
    if (loginResponse) recordAccountLogin(database, session.user.id, Date.now());
    clearRateLimit(key); return response;
  } catch (error) { return reply({ error: error instanceof LicenseError || error instanceof AccountInputError || error instanceof DeviceError ? error.message : '操作失败，请稍后重试' }, error instanceof LicenseError || error instanceof AccountInputError || error instanceof DeviceError ? error.status : 500); }
}
