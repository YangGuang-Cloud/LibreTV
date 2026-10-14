import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) } }));

/**
 * 聚合搜索接口单测：跨源聚合、同源去重、精确命中置顶、成人内容过滤、
 * 失败源不影响整体、SSRF 字面量拒绝。上游一律 mock fetch，无真实网络。
 */

function cmsList(items: Array<Record<string, unknown>>, pagecount = 1): string {
  return JSON.stringify({ code: 1, pagecount, list: items });
}

/** 按 URL 分发的上游 mock：cms-a 正常、cms-b 500、cms-c 与 a 有重叠条目 */
function mockUpstream(): void {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cms-a.example')) {
      return new Response(
        cmsList([
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
          { vod_id: 2, vod_name: '测试剧外传', type_name: '国产剧' },
          { vod_id: 3, vod_name: '福利速递', type_name: '福利视频' },
          // 同源同 vod_id 的重复条目：聚合时须按 sourceKey_vodId 去重
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('cms-b.example')) {
      return new Response('server error', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
}

function makeRequest(body: unknown, stream = false): Request {
  const { token } = signSession();
  return new Request(`https://local.test/api/search${stream ? '?stream=1' : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

const SOURCES = [
  { key: 'a', name: '源A', url: 'https://cms-a.example.com/api.php' },
  { key: 'b', name: '源B', url: 'https://cms-b.example.com/api.php' },
];

beforeAll(() => {
  process.env.PASSWORD = 'test-password-123';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/search', () => {
  it.each([null, [], { wd: 123, sources: SOURCES }, { wd: 'x', sources: [null] },
    { wd: 'x', sources: [{ key: 'x', name: 'x', url: 123 }] },
    { wd: 'x', sources: SOURCES, filterAdult: 'false' },
    { wd: 'x', sources: Array.from({ length: 51 }, () => SOURCES[0]) },
  ])('异常字段返回 400，不产生上游请求：%j', async (body) => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect((await POST(makeRequest(body))).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('同 URL 不同源编号/名称不会复用另一个配置的缓存', async () => {
    mockUpstream();
    const wd = '测试剧 缓存身份';
    // 多词相关性过滤需要全部命中，因此返回测试剧用另一不重叠缓存关键词。
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cmsList([{ vod_id: 1, vod_name: wd }]))));
    const first = await POST(makeRequest({ wd, sources: [SOURCES[0]] }));
    expect((await first.json()).list[0].sourceKey).toBe('a');
    const changed = { ...SOURCES[0], key: 'other', name: '另一配置' };
    const second = await POST(makeRequest({ wd, sources: [changed] }));
    expect((await second.json()).list[0]).toMatchObject({ sourceKey: 'other', sourceName: '另一配置' });
  });

  it('成人源标记改变后不复用缓存，过滤开启时不返回成人源内容', async () => {
    const wd = '成人源缓存回归';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cmsList([{ vod_id: 1, vod_name: wd }]))));
    const normal = await POST(makeRequest({ wd, sources: [SOURCES[0]], filterAdult: true }));
    expect((await normal.json()).list).toHaveLength(1);
    const adult = await POST(makeRequest({ wd, sources: [{ ...SOURCES[0], isAdult: true }], filterAdult: true }));
    expect((await adult.json()).list).toEqual([]);
  });

  it('服务器模式不需要客户端提交源地址，且不信任伪造的 URL', async () => {
    vi.stubEnv('SOURCE_MODE', 'server');
    vi.stubEnv('SERVER_DATA_DIR', '/private/tmp/libretv-test-no-config-search');
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '服务端源', url: SOURCES[0].url }]));
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(cmsList([{ vod_id: 1, vod_name: '服务器模式测试' }]));
    });
    vi.stubGlobal('fetch', spy);
    const res = await POST(makeRequest({ wd: '服务器模式测试', sourceKeys: ['env_0'], sources: [{ key: 'env_0', url: 'http://127.0.0.1/evil' }] }));
    expect(res.status).toBe(200);
    expect((await res.json()).list[0].sourceName).toBe('服务端源');
    expect(String(spy.mock.calls[0]?.[0])).toContain('cms-a.example.com');
    expect((await POST(makeRequest({ wd: 'x', sourceKeys: ['unknown'] }))).status).toBe(400);
  });

  it('接口地址已有查询参数时保留参数并正确追加搜索字段', async () => {
    const spy = vi.fn(async (input: RequestInfo | URL) => { void input; return new Response(cmsList([])); });
    vi.stubGlobal('fetch', spy);
    await POST(makeRequest({ wd: '参数回归', sources: [{ ...SOURCES[0], url: SOURCES[0].url + '?token=abc' }] }));
    const url = new URL(String(spy.mock.calls[0]?.[0]));
    expect(url.searchParams.get('token')).toBe('abc');
    expect(url.searchParams.get('wd')).toBe('参数回归');
  });
  it('聚合多源结果：同源去重、成人内容过滤、失败源进 failures', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: SOURCES, filterAdult: true }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      list: Array<{ sourceKey: string; vodId: string; name: string }>;
      failures: Array<{ sourceKey: string; error: string }>;
    };

    // 源A 的 4 条 → 去重后 2 条有效 + 成人条目被过滤
    const aItems = data.list.filter((i) => i.sourceKey === 'a');
    expect(aItems).toHaveLength(2);
    expect(aItems.map((i) => i.vodId).sort()).toEqual(['1', '2']);

    // 源B 500 → 记入 failures，不影响源A 的结果
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0].sourceKey).toBe('b');
    expect(data.failures[0].error).toContain('500');
  });

  it('精确命中（忽略标点差异）排在最前', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: [SOURCES[0]], filterAdult: true }));
    const data = (await res.json()) as { list: Array<{ name: string }> };
    expect(data.list[0]?.name).toBe('测试剧');
  });

  it('内网字面量地址在发起请求前被 SSRF 校验拒绝', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(
      makeRequest({
        wd: 'x',
        sources: [{ key: 'evil', name: '内网', url: 'http://192.168.1.100/api.php' }],
        filterAdult: false,
      })
    );
    const data = (await res.json()) as { failures: Array<{ sourceKey: string; error: string }> };
    expect(data.failures[0]?.sourceKey).toBe('evil');
    // 上游一次请求都不应发生
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stream=1 以 NDJSON 逐源推送并以 done 事件收尾', async () => {
    mockUpstream();
    // 用不同关键词避开同键短缓存（缓存命中时只推 done 事件，见 route.ts 缓存分支）
    const res = await POST(makeRequest({ wd: '流式检测关键词', sources: SOURCES, filterAdult: true }, true));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; sourceKey?: string });
    const sources = lines.filter((l) => l.type === 'source');
    const done = lines.filter((l) => l.type === 'done');
    // 每个源恰好一条 source 事件（含失败的源B），最后一条是 done
    expect(sources.map((l) => l.sourceKey).sort()).toEqual(['a', 'b']);
    expect(done).toHaveLength(1);
    expect(lines[lines.length - 1].type).toBe('done');
  });

  it('未登录返回 401，未配置密码返回 503', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const saved = process.env.PASSWORD;
    delete process.env.PASSWORD;
    try {
      const noPassword = await POST(makeRequest({ wd: 'x', sources: SOURCES }));
      expect(noPassword.status).toBe(503);
    } finally {
      process.env.PASSWORD = saved;
    }
    const noCookie = new Request('https://local.test/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wd: 'x', sources: SOURCES }),
    });
    const unauthorized = await POST(noCookie);
    expect(unauthorized.status).toBe(401);
  });
});
