import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, onUnauthorized } from './client-api';

afterEach(() => vi.unstubAllGlobals());

describe('请求失败的交互边界', () => {
  it('服务暂不可用只报告当前请求失败，不弹登录框', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '暂时不可用' }), { status: 503 })));
    const unauthorized = vi.fn(); const off = onUnauthorized(unauthorized);
    await expect(api.status()).rejects.toMatchObject({ status: 503, message: '暂时不可用' });
    expect(unauthorized).not.toHaveBeenCalled(); off();
  });
  it('真实登录失效仍通知重新登录', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const unauthorized = vi.fn(); const off = onUnauthorized(unauthorized);
    await expect(api.status()).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce(); off();
  });
});
