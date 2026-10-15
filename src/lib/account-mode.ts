/** 旧客户端仍可用共享密码；配置完成后由部署者显式切换账号模式。 */
export function accountMode(): boolean {
  return process.env.AUTH_MODE === 'account';
}

export function accountConfigured(): boolean {
  if ((process.env.BETTER_AUTH_SECRET || '').length < 32) return false;
  try {
    const url = new URL(process.env.BETTER_AUTH_URL || '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}
