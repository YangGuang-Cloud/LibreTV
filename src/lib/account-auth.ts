import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { admin, username } from 'better-auth/plugins';
import { accountConfigured } from './account-mode';
import { initializeSyncSchema } from './sync-schema';

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
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 32 }), admin()],
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
        initializeSyncSchema(state.database);
        return state;
      } catch (error) { state.database.close(); throw error; }
    })().catch((error) => { globalAccounts.lunaAccounts = undefined; throw error; });
  }
  return globalAccounts.lunaAccounts;
}

export async function getAccountSession(headers: Headers) {
  const { auth } = await getAccountAuth();
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  return session?.user.banned ? null : session;
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
  const { auth } = await getAccountAuth();
  return auth.handler(req);
}
