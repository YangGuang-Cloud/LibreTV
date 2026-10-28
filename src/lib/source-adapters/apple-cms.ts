import { cmsRequestHeaders, parseSearchList, parseDetail, parseDetailPageHtml } from '../cms-parser';
import { fetchUpstream } from '../fetch-utils';
import { checkUpstreamAllowed } from '../ssrf';
import { SourceAdapterError, type SourceAdapter } from './contract';

export const appleCMSAdapter: SourceAdapter = {
  id: 'apple-cms',
  async searchPage(source, query, page, { signal, timeoutMs = 8000 }) {
    const api = new URL(source.url);
    api.searchParams.set('ac', 'videolist');
    api.searchParams.set('wd', query);
    api.searchParams.set('pg', String(page));
    const res = await fetchUpstream(api.href, { timeoutMs, headers: cmsRequestHeaders(), signal });
    if (!res.ok) throw new SourceAdapterError(502, `HTTP ${res.status}`);
    const data: unknown = await res.json();
    const rawPageCount = data && typeof data === 'object' ? (data as { pagecount?: unknown }).pagecount : undefined;
    const count = parseInt(String(rawPageCount ?? '1'), 10);
    return { list: parseSearchList(data, source), pageCount: Number.isSafeInteger(count) ? Math.max(1, count) : 1 };
  },
  async detail(source, id, { signal, timeoutMs = 10000, baseUrl = '' }) {
    const verdict = await checkUpstreamAllowed(source.url);
    if (!verdict.ok) throw new SourceAdapterError(400, verdict.reason || '源地址不可用');
    const api = new URL(source.url);
    api.searchParams.set('ac', 'videolist');
    api.searchParams.set('ids', id);
    const res = await fetchUpstream(api.href, { timeoutMs, headers: cmsRequestHeaders(), signal });
    if (res.ok) {
      const data: unknown = await res.json();
      try {
        const detail = parseDetail(data, source);
        if (detail.episodes.length) return detail;
      } catch { /* Some CMS sources only expose playback URLs on the detail page. */ }
    }
    const root = (source.detail || baseUrl).replace(/\/+$/, '');
    if (root && /^https?:\/\//.test(root)) {
      const allowed = await checkUpstreamAllowed(root);
      if (!allowed.ok) throw new SourceAdapterError(400, allowed.reason || '详情页地址不可用');
      const html = await fetchUpstream(`${root}/index.php/vod/detail/id/${id}.html`, {
        signal, timeoutMs, headers: { 'User-Agent': cmsRequestHeaders()['User-Agent'] },
      });
      if (html.ok) {
        const detail = parseDetailPageHtml(await html.text(), source);
        if (detail?.episodes.length) return detail;
      }
    }
    throw new SourceAdapterError(404, '未找到播放资源');
  },
};
