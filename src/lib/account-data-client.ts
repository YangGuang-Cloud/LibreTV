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
    if (!response.ok) throw new AccountDataError(response.status === 401 ? '登录已失效，请重新登录' : response.status === 409 ? '账号状态已变化，请刷新页面' : '无法连接账号服务', response.status);
    const value: unknown = await response.json();
    if (!validSyncResponse(value)) throw new AccountDataError('账号数据响应格式无效');
    return value;
  } finally { clearTimeout(timer); }
};

/** 只有服务器确认的数据进入内存缓存；没有本地数据库、持久队列或失败重传。 */
export class OnlineAccountClient {
  private records = new Map<string, SyncRecord>();
  private cursor = 0;
  private closed = false;
  private sequence: Promise<unknown> = Promise.resolve();
  constructor(readonly accountId: string, private transport: AccountTransport = httpAccountTransport, private changed: () => void = () => {}, private failed: (error: unknown, writing: boolean) => void = () => {}) {}
  values<T>(collection: SyncCollection): T[] {
    return [...this.records.values()].filter((row) => row.collection === collection && row.value !== null).map((row) => structuredClone(row.value) as T);
  }
  rows(): SyncRecord[] { return structuredClone([...this.records.values()]); }
  get<T>(collection: SyncCollection, key: string): T | undefined { return structuredClone(this.records.get(syncId(collection, key))?.value ?? undefined) as T | undefined; }
  close() { this.closed = true; this.records.clear(); this.cursor = 0; }
  async settled() { await this.sequence; }
  private serialize<T>(run: () => Promise<T>, writing: boolean): Promise<T> {
    const request = this.sequence.then(async () => { if (this.closed) throw new AccountDataError('账号已变化'); return run(); });
    this.sequence = request.catch((error) => { if (!this.closed) this.failed(error, writing); });
    return request;
  }
  refresh(): Promise<void> { return this.serialize(() => this.pull(), false); }
  write(changes: AccountChange[] | ((client: OnlineAccountClient) => AccountChange[])): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const error = new AccountDataError('当前离线，无法保存到账号，请联网后重新操作');
      this.failed(error, true);
      return Promise.reject(error);
    }
    const submitted = typeof changes === 'function' ? changes : structuredClone(changes);
    return this.serialize(async () => {
      // 写入前读取当前服务器版本，断网时立即失败，不保存离线意图。
      await this.pull();
      const entries = typeof submitted === 'function' ? submitted(this) : submitted;
      const seen = new Set<string>();
      for (const entry of entries) {
        const id = syncId(entry.collection, entry.key);
        if (seen.has(id) || !entry.key || entry.key.length > 4096 || !validSyncValue(entry.collection, entry.key, entry.value) || JSON.stringify(entry.value).length > 256_000) throw new AccountDataError('保存内容格式无效或过大');
        seen.add(id);
      }
      // 请求在内存中串行发出，失败即结束；不会在恢复网络后重放。
      for (let offset = 0; offset < entries.length;) {
        const mutations: SyncRequest['mutations'] = [];
        let size = 0;
        for (const entry of entries.slice(offset, offset + SYNC_BATCH_SIZE)) {
          size += new TextEncoder().encode(JSON.stringify(entry.value)).byteLength + 500;
          if (size > 1_500_000) break;
          mutations.push({ ...entry, id: crypto.randomUUID(), baseVersion: this.records.get(syncId(entry.collection, entry.key))?.version || 0 });
        }
        if (!mutations.length) throw new AccountDataError('保存内容过大');
        // 不足一批的大小切分也必须发送剩余条目。
        offset += mutations.length;
        const response = await this.request(mutations);
        await this.consume(response);
        if (response.results.some((result) => !result.accepted)) throw new AccountDataError('内容已在其他设备更新，请检查最新数据后重试', 409);
      }
    }, true);
  }
  private async request(mutations: SyncRequest['mutations'] = [], cursor = this.cursor) {
    const response = await this.transport({ protocol: SYNC_PROTOCOL, accountId: this.accountId, cursor, mutations });
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
    this.records = records; this.cursor = response.cursor;
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
