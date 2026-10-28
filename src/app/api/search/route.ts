import { getSourceAdapter } from '@/lib/source-adapters';
import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { filterAdultResults, filterRelevantResults, normalizeTitle } from '@/lib/search-result-utils';
import { getCache, setCache } from '@/lib/fetch-utils';
import type { SearchResponse, SearchStreamEvent, SourceConfig, SourceSearchOutcome } from '@/lib/types';
import { parseSourceConfig, sourceCacheIdentity } from '@/lib/source-config';
import { resolveServerSources, serverSourceMode } from '@/lib/server-sources';
import { mapWithConcurrency } from '@/lib/concurrency';

export const runtime = 'nodejs';

interface SearchBody {
  wd: string;
  sources?: SourceConfig[];
  sourceKeys?: string[];
  filterAdult?: boolean;
}

/** 搜索结果短缓存：同一关键词 + 同一组源在 TTL 内直接返回（播放页返回搜索页等场景） */
const SEARCH_CACHE_TTL = 60 * 1000;

/** 缓存含源身份与过滤标记，避免同 URL 不同配置之间串结果。 */
function searchCacheKey(wd: string, sources: SourceConfig[], filterAdult: boolean): string {
  const identities = sources.map((s) => JSON.stringify(sourceCacheIdentity(s))).sort();
  return `search:${JSON.stringify([wd, filterAdult, identities])}`;
}

/**
 * 每个源最多抓取的页数。
 * 第一页响应会带回 pagecount（源站真实总页数），实际抓取页数 = min(pagecount, 该值)。
 * 默认 5；页与页之间并行请求，单页失败只丢弃该页。
 */
const SEARCH_MAX_PAGES = (() => {
  const n = parseInt(process.env.SEARCH_MAX_PAGES || '5', 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(50, Math.max(1, n));
})();

/**
 * 单源总死线（毫秒）：该源所有分页请求必须在时限内完成，到点中断在途请求并标记超时。
 * 没有它时慢源最坏要等「首页 8s + 后续页并行 8s」，拖垮整体响应。
 * 环境变量 SEARCH_SOURCE_TIMEOUT_MS 可配，默认 10s。
 */
const SEARCH_SOURCE_TIMEOUT_MS = (() => {
  const n = parseInt(process.env.SEARCH_SOURCE_TIMEOUT_MS || '10000', 10);
  if (!Number.isFinite(n)) return 10000;
  return Math.min(60000, Math.max(3000, n));
})();

/** AbortSignal.timeout / 源级死线中断均以 TimeoutError 语义呈现（直接抛出或挂在 cause 上） */
function isTimeoutError(err: unknown): boolean {
  const candidates: unknown[] = [err, err instanceof Error ? err.cause : undefined];
  return candidates.some((e) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'));
}

/**
 * 服务端聚合搜索：并行请求所有选中源，任一源失败不影响整体。
 * 每个源先取第一页并读取 pagecount，再并行抓取后续页（上限 SEARCH_MAX_PAGES），
 * 整源受 SEARCH_SOURCE_TIMEOUT_MS 总死线约束。
 * 旧版在浏览器里打满 N 个请求（暴露用户 IP、无法缓存、超时失控），现全部上移。
 */
async function searchSource(source: SourceConfig, wd: string, parentSignal: AbortSignal): Promise<SourceSearchOutcome> {
  const start = Date.now();
  const finish = (outcome: Omit<SourceSearchOutcome, 'ms'>): SourceSearchOutcome => ({
    ...outcome,
    ms: Date.now() - start,
  });

  if (!/^https?:\/\//.test(source.url || '')) {
    return finish({ sourceKey: source.key, ok: false, list: [], error: '无效的源地址' });
  }
  // 死线到点中断该源所有在途分页请求，避免后台继续空耗
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, parentSignal]);
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SourceSearchOutcome>((resolve) => {
    deadlineTimer = setTimeout(() => {
      controller.abort(new DOMException('源搜索超时', 'TimeoutError'));
      resolve(
        finish({
          sourceKey: source.key,
          ok: false,
          list: [],
          error: `请求超时（>${Math.round(SEARCH_SOURCE_TIMEOUT_MS / 1000)}s）`,
          timedOut: true,
        })
      );
    }, SEARCH_SOURCE_TIMEOUT_MS);
  });

  const fetchPage = (page: number) => getSourceAdapter(source).searchPage(source, wd, page, { timeoutMs: 8000, signal });

  const run = async (): Promise<SourceSearchOutcome> => {
    const first = await fetchPage(1);
    const list = [...first.list];
    const pageCount = Math.min(first.pageCount, SEARCH_MAX_PAGES);
    if (pageCount > 1) {
      const extraPages = await mapWithConcurrency(
        Array.from({ length: pageCount - 1 }, (_, i) => i + 2), 3, async (page) => {
          try {
            return (await fetchPage(page)).list;
          } catch {
            return [];
          }
        }, signal,
      );
      list.push(...extraPages.flat());
    }
    return { sourceKey: source.key, ok: true, list };
  };

  try {
    // 死线先到时 run 仍会在后台被 abort 并 reject，必须先挂 catch 防未处理 rejection
    const runPromise = run()
      .then(finish)
      .catch((err: unknown): SourceSearchOutcome =>
        finish({
          sourceKey: source.key,
          ok: false,
          list: [],
          error: err instanceof Error ? err.message : '请求失败',
          timedOut: isTimeoutError(err),
        })
      );
    return await Promise.race([runPromise, deadline]);
  } catch (err) {
    return finish({
      sourceKey: source.key,
      ok: false,
      list: [],
      error: err instanceof Error ? err.message : '请求失败',
      timedOut: isTimeoutError(err),
    });
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/** 合并 + 去重 + 过滤 + 排序，stream 与非 stream 两种模式共用 */
function aggregateOutcomes(outcomes: SourceSearchOutcome[], wd: string, filterAdult: boolean): SearchResponse {
  const seen = new Set<string>();
  let list = outcomes.flatMap((o) => o.list).filter((item) => {
    const key = `${item.sourceKey}_${item.vodId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  list = filterAdultResults(list, filterAdult);
  // 部分源站做分词/OR 模糊搜索（搜「摔跤吧！爸爸」返回一堆「爸爸XXX」），按关键词过滤
  list = filterRelevantResults(list, wd);

  // 精确命中（忽略标点差异）排在最前，其余按名称（与旧版一致），名称相同按源名
  const exact = normalizeTitle(wd);
  list.sort((a, b) => {
    const aExact = normalizeTitle(a.name || '') === exact ? 0 : 1;
    const bExact = normalizeTitle(b.name || '') === exact ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const nameCompare = (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
    if (nameCompare !== 0) return nameCompare;
    return (a.sourceName || '').localeCompare(b.sourceName || '', 'zh-Hans-CN');
  });

  const failures = outcomes
    .filter((o) => !o.ok)
    .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut }));

  return { list, failures };
}

/**
 * 服务端聚合搜索：
 * - 默认返回完整 JSON（换源流程使用）；
 * - `?stream=1` 以 NDJSON 逐源推送（完成一个推一条，健康源的结果不再等坏源超时），
 *   最终推送聚合后的 done 事件并写入短缓存。
 */
export async function POST(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || typeof body.wd !== 'string') {
    return NextResponse.json({ error: '搜索关键词无效' }, { status: 400 });
  }
  const wd = body.wd.trim();
  if (!wd || wd.length > 100) {
    return NextResponse.json({ error: '搜索关键词无效' }, { status: 400 });
  }
  if (body.filterAdult !== undefined && typeof body.filterAdult !== 'boolean') {
    return NextResponse.json({ error: '搜索过滤配置无效' }, { status: 400 });
  }
  let sources: SourceConfig[];
  if (serverSourceMode()) {
    try {
      const keys: unknown = body.sourceKeys ?? (Array.isArray(body.sources)
        ? body.sources.map((source) => source?.key) : undefined);
      sources = await resolveServerSources(keys, req);
    } catch {
      return NextResponse.json({ error: '源配置无效或已更新，请刷新源列表' }, { status: 400 });
    }
  } else {
    if (!Array.isArray(body.sources) || body.sources.length === 0) {
      return NextResponse.json({ error: '请至少选择一个点播源' }, { status: 400 });
    }
    if (body.sources.length > 50) {
      return NextResponse.json({ error: '搜索配置无效（最多 50 个源）' }, { status: 400 });
    }
    const parsed = body.sources.map(parseSourceConfig);
    if (parsed.some((source) => !source)) {
      return NextResponse.json({ error: '点播源配置无效' }, { status: 400 });
    }
    sources = parsed as SourceConfig[];
    if (new Set(sources.map((source) => source.key)).size !== sources.length) {
      return NextResponse.json({ error: '点播源编号重复' }, { status: 400 });
    }
  }
  if (!sources.length) return NextResponse.json({ error: '暂无可用点播源' }, { status: 400 });
  const filterAdult = body.filterAdult !== false;

  const cacheKey = searchCacheKey(wd, sources, filterAdult);
  const cached = getCache<SearchResponse>(cacheKey);
  if (cached) {
    // 流式模式下缓存命中也要走 done 事件，客户端解析逻辑保持单一
    if (new URL(req.url).searchParams.get('stream') === '1') {
      const event: SearchStreamEvent = { type: 'done', list: cached.list, failures: cached.failures };
      return new Response(JSON.stringify(event) + '\n', {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json(cached);
  }

  const isStream = new URL(req.url).searchParams.get('stream') === '1';
  const requestController = new AbortController();
  const signal = AbortSignal.any([req.signal, requestController.signal]);
  if (!isStream) {
    let outcomes: SourceSearchOutcome[];
    try {
      outcomes = await mapWithConcurrency(sources, 5, (source) => searchSource(source, wd, signal), signal);
      signal.throwIfAborted();
    } catch {
      return NextResponse.json({ error: '搜索已取消' }, { status: 499 });
    }
    const payload = aggregateOutcomes(outcomes, wd, filterAdult);
    setCache(cacheKey, payload, SEARCH_CACHE_TTL);
    return NextResponse.json(payload);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: SearchStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true; // 客户端已断开
        }
      };

      // 逐源结算即推送，有界并发同时保留稳定的聚合顺序。
      void (async () => {
        const outcomes = await mapWithConcurrency(
          sources, 5, async (source) => {
            const outcome = await searchSource(source, wd, signal);
            send({ type: 'source', ...outcome });
            return outcome;
          }, signal,
        );
        signal.throwIfAborted();
        const payload = aggregateOutcomes(outcomes, wd, filterAdult);
        setCache(cacheKey, payload, SEARCH_CACHE_TTL);
        send({ type: 'done', list: payload.list, failures: payload.failures });
        closed = true;
        try { controller.close(); } catch { /* 已断开 */ }
      })().catch((error: unknown) => {
        closed = true;
        try { controller.error(error); } catch { /* 已取消 */ }
      });
    },
    cancel() { requestController.abort(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
