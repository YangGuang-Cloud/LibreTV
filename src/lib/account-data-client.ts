import { SYNC_PROTOCOL, SYNC_BATCH_SIZE, syncId, validSyncResponse, validSyncValue, type SyncCollection, type SyncRecord, type SyncRequest, type SyncResponse } from './sync-model';

export interface AccountChange { collection: SyncCollection; key: string; value: unknown; }
export type AccountTransport = (request: SyncRequest) => Promise<SyncResponse>;
export class AccountDataError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
export const httpAccountTransport: AccountTransport = async (body) => {
  const raw = JSON.stringify(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('/api/user/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw,
      keepalive: new TextEncoder().encode(raw).byteLength < 60_000, signal: controller.signal,
    });
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
    if (!response.ok) throw new AccountDataError(response.status === 401 ? '登录已失效，请重新登录' : response.status === 409 ? '账号状态已变化，请刷新页面' : '无法连接账号服务', response.status);
    const value: unknown = await response.json();
    if (!validSyncResponse(value)) throw new AccountDataError('账号数据响应格式无效');
    return value;
  } finally { clearTimeout(timer); }
};

/** 会话内的数据视图：服务器快照叠加待确认操作；不写本地文件或持久队列。 */
export class OnlineAccountClient {
  private records = new Map<string, SyncRecord>();
  private cursor = 0;
  private closed = false;
  private sequence: Promise<unknown> = Promise.resolve();
  private refreshRequest: Promise<void> | null = null;
  private lastRead = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private building: Map<string, SyncRecord> | null = null;
  private pending: {
    changes: AccountChange[]; build?: (client: OnlineAccountClient) => AccountChange[];
    clearing: SyncCollection[]; resolve: () => void; reject: (error: unknown) => void;
  }[] = [];
  constructor(readonly accountId: string, private transport: AccountTransport = httpAccountTransport, private changed: () => void = () => {}, private failed: (error: unknown, writing: boolean) => void = () => {}) {}
  private view() {
    if (this.building) return this.building;
    const rows = new Map(this.records);
    for (const job of this.pending) {
      for (const row of rows.values()) if (job.clearing.includes(row.collection)) rows.set(syncId(row.collection, row.key), { ...row, value: null });
      this.overlay(rows, job.changes);
    }
    return rows;
  }
  private overlay(rows: Map<string, SyncRecord>, changes: AccountChange[]) {
    for (const change of changes) rows.set(syncId(change.collection, change.key), { ...change, version: 0, updatedAt: 0 });
  }
  values<T>(collection: SyncCollection): T[] {
    return [...this.view().values()].filter((row) => row.collection === collection && row.value !== null).map((row) => structuredClone(row.value) as T);
  }
  rows(): SyncRecord[] { return structuredClone([...this.view().values()]); }
  get<T>(collection: SyncCollection, key: string): T | undefined { return structuredClone(this.view().get(syncId(collection, key))?.value ?? undefined) as T | undefined; }
  close() {
    this.closed = true; this.records.clear(); this.cursor = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const job of this.pending.splice(0)) job.reject(new AccountDataError('账号已变化'));
  }
  async settled() {
    while (this.pending.length || this.flushing) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      await this.flush();
    }
    await this.sequence;
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const request = this.sequence.then(async () => { if (this.closed) throw new AccountDataError('账号已变化'); return run(); });
    this.sequence = request.catch(() => {});
    return request;
  }
  refresh(force = true): Promise<void> {
    if (this.closed) return Promise.reject(new AccountDataError('账号已变化'));
    if (this.refreshRequest) return this.refreshRequest;
    if (!force && Date.now() - this.lastRead < 10_000) return Promise.resolve();
    const request = this.serialize(() => this.pull()).catch((error) => {
      if (!this.closed) this.failed(error, false);
      throw error;
    }).finally(() => { if (this.refreshRequest === request) this.refreshRequest = null; });
    this.refreshRequest = request;
    return request;
  }
  write(input: AccountChange[] | ((client: OnlineAccountClient) => AccountChange[]), clearing: SyncCollection[] = []): Promise<void> {
    if (this.closed) return Promise.reject(new AccountDataError('账号已变化'));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const error = new AccountDataError('当前离线，无法保存到账号，请联网后重新操作');
      this.failed(error, true);
      return Promise.reject(error);
    }
    let changes: AccountChange[];
    try { changes = structuredClone(typeof input === 'function' ? input(this) : input); this.validate(changes); }
    catch (error) { this.failed(error, true); return Promise.reject(error); }
    const request = new Promise<void>((resolve, reject) => {
      this.pending.push({ changes, clearing, build: typeof input === 'function' ? input : undefined, resolve, reject });
    });
    this.changed();
    if (!this.timer && !this.flushing) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 80);
    return request;
  }
  clear(collections: SyncCollection[]): Promise<void> {
    return this.write((client) => client.rows().filter((row) => collections.includes(row.collection) && row.value !== null).map((row) => ({ collection: row.collection, key: row.key, value: null })), collections);
  }
  private validate(entries: AccountChange[]) {
    const seen = new Set<string>();
    for (const entry of entries) {
      const id = syncId(entry.collection, entry.key);
      if (seen.has(id) || !entry.key || entry.key.length > 4096 || !validSyncValue(entry.collection, entry.key, entry.value) || JSON.stringify(entry.value).length > 256_000) throw new AccountDataError('保存内容格式无效或过大');
      seen.add(id);
    }
  }
  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const task = this.serialize(async () => {
      while (this.pending.length && !this.closed) {
        const jobs = [...this.pending];
        let failure: unknown;
        try {
          // 一批操作只读取一次当前版本，避免把旧版本当成当前用户意图。
          await this.pull();
          const working = new Map(this.records);
          const merged = new Map<string, AccountChange>();
          for (const job of jobs) {
            this.building = working;
            let entries: AccountChange[];
            try { entries = job.build ? job.build(this) : job.changes; this.validate(entries); }
            finally { this.building = null; }
            this.overlay(working, entries);
            for (const entry of entries) merged.set(syncId(entry.collection, entry.key), entry);
          }
          const entries = [...merged.values()];
          for (let offset = 0; offset < entries.length;) {
            const mutations: SyncRequest['mutations'] = [];
            let size = 0;
            for (const entry of entries.slice(offset, offset + SYNC_BATCH_SIZE)) {
              size += new TextEncoder().encode(JSON.stringify(entry.value)).byteLength + 500;
              if (size > 1_500_000) break;
              mutations.push({ ...entry, id: crypto.randomUUID(), baseVersion: this.records.get(syncId(entry.collection, entry.key))?.version || 0 });
            }
            if (!mutations.length) throw new AccountDataError('保存内容过大');
            offset += mutations.length;
            const response = await this.request(mutations);
            await this.consume(response);
            if (response.results.some((result) => !result.accepted)) throw new AccountDataError('内容已在其他设备更新，请检查最新数据后重试', 409);
          }
        } catch (error) { failure = error; }
        this.pending = this.pending.filter((job) => !jobs.includes(job));
        if (!this.closed) {
          this.changed();
          if (failure) this.failed(failure, true);
        }
        for (const job of jobs) { if (failure) job.reject(failure); else job.resolve(); }
      }
    });
    this.flushing = task.catch(() => { /* close() 已结束待确认操作 */ }).finally(() => {
      this.flushing = null;
      if (!this.closed && this.pending.length && !this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 80);
    });
    return this.flushing;
  }
  private async request(mutations: SyncRequest['mutations'] = [], cursor = this.cursor) {
    const payload = { protocol: SYNC_PROTOCOL, accountId: this.accountId, cursor, mutations };
    let response: SyncResponse;
    try { response = await this.transport(payload); }
    catch (error) {
      // 使用同一 mutation id 重试一次；服务端去重，避免响应丢失后重复写入。
      const retryable = !(error instanceof AccountDataError) || [500, 502, 503, 504].includes(error.status);
      if (this.closed || !retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (this.closed) throw new AccountDataError('账号已变化');
      response = await this.transport(payload);
    }
    if (this.closed) throw new AccountDataError('账号已变化');
    if (!validSyncResponse(response) || response.accountId !== this.accountId || response.cursor < cursor || response.results.length !== mutations.length || response.results.some((result, i) => result.id !== mutations[i].id || result.record.collection !== mutations[i].collection || result.record.key !== mutations[i].key)) throw new AccountDataError('账号数据确认无效');
    return response;
  }
  private async pull() { await this.consume(await this.request()); }
  private async consume(first: SyncResponse) {
    const records = new Map(this.records);
    let response = first;
    const apply = (row: SyncRecord) => {
      const id = syncId(row.collection, row.key);
      if ((records.get(id)?.version ?? -1) < row.version) records.set(id, row);
    };
    for (let page = 0; ; page++) {
      for (const result of response.results) apply(result.record);
      for (const row of response.records) apply(row);
      if (!response.more) break;
      if (page >= 100) throw new AccountDataError('账号数据过多，请联系管理员');
      response = await this.request([], response.cursor);
    }
    if (this.closed) throw new AccountDataError('账号已变化');
    this.records = records; this.cursor = response.cursor; this.lastRead = Date.now();
    this.changed();
  }
}

let current: OnlineAccountClient | null = null;
export function setAccountClient(client: OnlineAccountClient | null) { current = client; }
export function accountClient(): OnlineAccountClient {
  if (!current) throw new AccountDataError('请登录个人账号后保存数据');
  return current;
}
export function cachedAccountClient() { return current; }
