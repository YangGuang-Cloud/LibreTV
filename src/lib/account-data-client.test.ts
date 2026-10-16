import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { initializeSyncSchema } from './sync-schema';
import { exchangeUserData } from './server-user-sync';
import { OnlineAccountClient, AccountDataError, type AccountTransport } from './account-data-client';
import { validSyncRequest } from './sync-model';

let database: Database.Database;
let offline = false;
const transport: AccountTransport = async (request) => { if (offline) throw new TypeError('断网'); expect(validSyncRequest(request)).toBe(true); return exchangeUserData(database, 'a', request); };
const progress = (position: number, key = 's_film_0') => ({ collection: 'progress' as const, key, value: { key, position, duration: 500, updatedAt: Date.now() } });
const history = (id = 's_film') => ({ collection: 'history' as const, key: id, value: { id, sourceKey: 's', vodId: id.slice(2), title: '测试影片', episodeIndex: 0, totalEpisodes: 5, playbackPosition: 90, duration: 500, timestamp: Date.now() } });
beforeEach(() => { offline = false; database = new Database(':memory:'); database.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user(id) VALUES ('a'), ('b');"); initializeSyncSchema(database); });
afterEach(() => { database.close(); vi.unstubAllGlobals(); });

describe('个人数据直接读写服务器，只有内存缓存', () => {
  it('新的页面实例没有任何旧缓存，读取服务器后恢复全部个人数据', async () => {
    const a = new OnlineAccountClient('a', transport);
    await a.write([history(), progress(90), { collection: 'search', key: '影片', value: { text: '影片', timestamp: Date.now() } }, { collection: 'preference', key: 'adFilter', value: false }, { collection: 'favorite', key: 'https://example.com/live', value: true }]);
    a.close();
    const b = new OnlineAccountClient('a', transport);
    expect(b.rows()).toEqual([]);
    await b.refresh();
    expect(b.get('history', 's_film')).toMatchObject({ title: '测试影片' });
    expect(b.get('progress', 's_film_0')).toMatchObject({ position: 90 });
    expect(b.get('preference', 'adFilter')).toBe(false);
    expect(b.get('favorite', 'https://example.com/live')).toBe(true);
    const other = new OnlineAccountClient('b', async (request) => exchangeUserData(database, 'b', request));
    await other.refresh(); expect(other.rows()).toEqual([]);
  });
  it('断网写入失败不会改变已确认缓存，恢复网络后只读取，不补传', async () => {
    const a = new OnlineAccountClient('a', transport);
    await a.write([progress(30)]); offline = true;
    await expect(a.write([progress(120)])).rejects.toThrow('断网');
    expect(a.get('progress', 's_film_0')).toMatchObject({ position: 30 });
    offline = false; await a.refresh();
    expect(a.get('progress', 's_film_0')).toMatchObject({ position: 30 });
    const b = new OnlineAccountClient('a', transport); await b.refresh();
    expect(b.get('progress', 's_film_0')).toMatchObject({ position: 30 });
  });
  it('浏览器已知离线时立即拒绝保存，不把修改排在网络请求后面', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const request = vi.fn(transport);
    const client = new OnlineAccountClient('a', request);
    await expect(client.write([progress(120)])).rejects.toThrow('当前离线');
    expect(request).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true });
    await client.refresh(); expect(client.values('progress')).toEqual([]);
    expect(request.mock.calls[0][0].mutations).toEqual([]);
  });
  it('下一次成功写入可以保存主动回看的更小进度', async () => {
    const a = new OnlineAccountClient('a', transport); const b = new OnlineAccountClient('a', transport);
    await a.write([progress(240)]); await b.refresh(); await b.write([progress(60)]); await a.refresh();
    expect(a.get('progress', 's_film_0')).toMatchObject({ position: 60 });
  });
  it('写入立即展示，冲突采用服务器内容并报告失败', async () => {
    const normal = new OnlineAccountClient('a', transport); await normal.write([progress(20)]);
    let release!: () => void; let reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const entered = new Promise<void>((resolve) => { reached = resolve; });
    const delayed = new OnlineAccountClient('a', async (request) => { if (request.mutations.length) { reached(); await gate; } return transport(request); });
    await delayed.refresh();
    const writing = delayed.write([progress(70)]); await entered;
    expect(delayed.get('progress', 's_film_0')).toMatchObject({ position: 70 });
    await normal.write([progress(100)]); release();
    await expect(writing).rejects.toThrow('其他设备更新');
    expect(delayed.get('progress', 's_film_0')).toMatchObject({ position: 100 });
  });
  it('分页和大批保存完成后，删除会在另一个页面读取时生效', async () => {
    const a = new OnlineAccountClient('a', transport); const b = new OnlineAccountClient('a', transport);
    await a.write(Array.from({ length: 620 }, (_, i) => progress(i + 1, `p_${i}`)));
    await b.refresh(); expect(b.values('progress')).toHaveLength(620);
    await a.write((client) => client.rows().filter((row) => row.collection === 'progress').map((row) => ({ collection: row.collection, key: row.key, value: null })));
    await b.refresh(); expect(b.values('progress')).toEqual([]);
  });
  it('响应属于其他账号时，内存不会接受其数据', async () => {
    const a = new OnlineAccountClient('a', async (request) => ({ ...await transport(request), accountId: 'b' }));
    await expect(a.refresh()).rejects.toThrow('确认无效'); expect(a.rows()).toEqual([]);
  });
  it('无效配置在写数据库前被拒绝，不会产生部分写入', async () => {
    const a = new OnlineAccountClient('a', transport);
    await expect(a.write([history(), { collection: 'preference', key: 'role', value: 'admin' }])).rejects.toThrow('格式无效');
    expect(database.prepare('SELECT * FROM user_sync_data').all()).toEqual([]);
  });
});


describe('统一会话数据管理', () => {
  it('写入立刻可见，短时间同一字段只提交最终值', async () => {
    const request = vi.fn(transport);
    const client = new OnlineAccountClient('a', request);
    await client.refresh(); request.mockClear();
    const first = client.write([{ collection: 'preference', key: 'adFilter', value: false }]);
    expect(client.get('preference', 'adFilter')).toBe(false);
    const second = client.write([{ collection: 'preference', key: 'adFilter', value: true }]);
    const third = client.write([progress(80)]);
    expect(client.get('preference', 'adFilter')).toBe(true);
    expect(client.get('progress', 's_film_0')).toMatchObject({ position: 80 });
    await Promise.all([first, second, third]);
    expect(request).toHaveBeenCalledTimes(2);
    const writes = request.mock.calls.filter(([input]) => input.mutations.length);
    expect(writes).toHaveLength(1);
    expect(writes[0][0].mutations).toHaveLength(2);
    expect(writes[0][0].mutations.find((row) => row.key === 'adFilter')?.value).toBe(true);
  });
  it('并发刷新共用请求，近期数据无需重新等待', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async (input) => { await gate; return transport(input); });
    const client = new OnlineAccountClient('a', request);
    const first = client.refresh(); const second = client.refresh();
    release(); await Promise.all([first, second]);
    await client.refresh(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('响应丢失后用相同操作编号重试，服务器只修改一次', async () => {
    let lost = false;
    const ids: string[] = [];
    const client = new OnlineAccountClient('a', async (input) => {
      const response = await transport(input);
      if (input.mutations.length) {
        ids.push(input.mutations[0].id);
        if (!lost) { lost = true; throw new TypeError('响应丢失'); }
      }
      return response;
    });
    await client.write([progress(88)]);
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
    expect(database.prepare('SELECT version FROM user_sync_data').get()).toMatchObject({ version: 1 });
    expect(client.get('progress', 's_film_0')).toMatchObject({ position: 88 });
  });
  it('较早操作失败不能覆盖后来尚在同步的操作', async () => {
    let rejectFirst!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { rejectFirst = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let fail = true;
    const client = new OnlineAccountClient('a', async (input) => {
      if (input.mutations.length && fail) { fail = false; entered(); await gate; throw new AccountDataError('冲突', 409); }
      return transport(input);
    });
    await client.refresh();
    const first = client.write([progress(20)]).catch(() => {});
    await started;
    const second = client.write([progress(99)]);
    rejectFirst(); await first;
    expect(client.get('progress', 's_film_0')).toMatchObject({ position: 99 });
    await second;
    expect(client.get('progress', 's_film_0')).toMatchObject({ position: 99 });
  });
  it('账号关闭清理暂存，迟到的响应不能复活旧账号数据', async () => {
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const changed = vi.fn();
    const client = new OnlineAccountClient('a', async (input) => {
      if (input.mutations.length) { entered(); await gate; }
      return transport(input);
    }, changed);
    const write = client.write([progress(90)]).catch(() => {});
    await started; client.close(); changed.mockClear(); release();
    await write; await client.settled();
    expect(client.rows()).toEqual([]); expect(changed).not.toHaveBeenCalled();
  });
  it('清空时也包含其他设备刚刚新增的记录', async () => {
    const first = new OnlineAccountClient('a', transport);
    const other = new OnlineAccountClient('a', transport);
    await first.write([progress(1, 'one')]);
    await other.write([progress(2, 'two')]);
    const writing = first.clear(['progress']);
    expect(first.values('progress')).toEqual([]);
    await writing;
    await other.refresh(); expect(other.values('progress')).toEqual([]);
  });
});
