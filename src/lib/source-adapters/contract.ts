import type { SourceAdapterID } from '../source-adapter-catalog';
import type { SourceConfig, SearchResultItem, VideoDetail } from '../types';

export class SourceAdapterError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface SourceRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface SourceSearchPage {
  list: SearchResultItem[];
  /** Already normalized; callers apply their own pagination and concurrency limits. */
  pageCount: number;
}
export interface SourceAdapter {
  id: SourceAdapterID;
  searchPage(source: SourceConfig, query: string, page: number, options: SourceRequestOptions): Promise<SourceSearchPage>;
  detail(source: SourceConfig, id: string, options: SourceRequestOptions & { baseUrl?: string }): Promise<VideoDetail>;
}
