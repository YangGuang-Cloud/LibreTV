import fs from 'node:fs';
import { initializeLicenses, accountAccess } from './account-licenses';
import path from 'node:path';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { admin, username } from 'better-auth/plugins';
import { accountConfigured } from './account-mode';
import { initializePasswordVault, passwordVaultKey, captureManagedPassword } from './account-password-vault';
import { initializeSyncSchema } from './sync-schema';
import { initializeAccountActivity } from './account-activity';
import { initializeAccountLoginState, recordAccountLogin } from './account-login-state';

function createAccountAuth() {
  if (!accountConfigured()) throw new Error('请配置 BETTER_AUTH_URL 和至少 32 字符的 BETTER_AUTH_SECRET');
  const directory = path.resolve(process.env.SERVER_DATA_DIR || path.join(process.cwd(), '.data'));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'accounts.sqlite');
  const database = new Database(filename);
  fs.chmodSync(filename, 0o600);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  const auth = betterAuth({
    appName: 'Luna12TV',
    baseURL: process.env.BETTER_AUTH_URL!,
    secret: process.env.BETTER_AUTH_SECRET!,
    telemetry: { enabled: false },
    database,
    advanced: { disableCSRFCheck: false, disableOriginCheck: false },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 6, maxPasswordLength: 128 },
    session: { expiresIn: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: 60, customRules: { '/sign-in/username': { window: 600, max: 10 } } },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 32, usernameNormalization: false }), admin()],
    databaseHooks: {
      session: { create: { after: async (session, context) => {
        if (context?.path === '/sign-in/username' && accountAccess(database, session.userId).state === 'active') recordAccountLogin(database, session.userId, session.createdAt.getTime());
      } } },
    },
  });
  return { auth, database };
}

type AccountAuth = ReturnType<typeof createAccountAuth>;
// Next 开发热更新复用连接；初始化失败后允许重试，不在构建阶段创建数据库。
const globalAccounts = globalThis as typeof globalThis & { lunaAccounts?: Promise<AccountAuth> };
export function getAccountAuth(): Promise<AccountAuth> {
  if (!globalAccounts.lunaAccounts) {
    globalAccounts.lunaAccounts = (async () => {
      const state = createAccountAuth();
      try {
        const { runMigrations } = await getMigrations(state.auth.options);
        await runMigrations();
        initializeLicenses(state.database);
        initializeSyncSchema(state.database);
        initializePasswordVault(state.database);
        initializeAccountLoginState(state.database);
        initializeAccountActivity(state.database);
        return state;
      } catch (error) { state.database.close(); throw error; }
    })().catch((error) => { globalAccounts.lunaAccounts = undefined; throw error; });
  }
  return globalAccounts.lunaAccounts;
}

export async function getAccountSession(headers: Headers, allowExpired = false) {
  const { auth } = await getAccountAuth();
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!session || session.user.banned) return null;
  return allowExpired || accountAccess((await getAccountAuth()).database, session.user.id).state === 'active' ? session : null;
}

/** 管理操作只从现有独立管理员会话进入；不向浏览器暴露框架的管理端点。 */
export async function accountAuthHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    const trusted = new URL(process.env.BETTER_AUTH_URL!).origin;
    let valid = req.headers.get('sec-fetch-site') !== 'cross-site';
    if (origin) valid = valid && origin === trusted;
    else if (referer) {
      try { valid = valid && new URL(referer).origin === trusted; } catch { valid = false; }
    }
    if (!valid) return Response.json({ error: '请求来源无效' }, { status: 403 });
  }
  const { auth, database } = await getAccountAuth();
  let change: { userId: string; password: string; key: Buffer } | undefined;
  if (req.method === 'POST' && new URL(req.url).pathname === '/api/auth/change-password') {
    let body: { newPassword?: unknown } | undefined;
    try {
      const raw = await req.clone().text();
      if (raw.length > 8192) return Response.json({ error: '请求过大' }, { status: 413 });
      body = JSON.parse(raw);
    } catch { /* 框架负责返回原有的请求格式错误 */ }
    if (typeof body?.newPassword === 'string' && body.newPassword.length >= 6 && body.newPassword.length <= 128) {
      const session = await getAccountSession(req.headers);
      if (session) {
        try { change = { userId: session.user.id, password: body.newPassword, key: passwordVaultKey(database, true) }; }
        catch { return Response.json({ error: '密码加密存储不可用，请联系管理员检查密钥' }, { status: 503 }); }
      }
    }
  }
  const response = await auth.handler(req);
  if (response.ok && change) {
    // 更新失败时 hash 绑定仍会使旧副本不可查看；不将已完成的改密误报为失败。
    try { await captureManagedPassword(database, change.key, change.userId, change.password); }
    catch { /* 登录哈希已更新，管理员列表会标记为需重置后查看 */ }
  }
  return response;
}
