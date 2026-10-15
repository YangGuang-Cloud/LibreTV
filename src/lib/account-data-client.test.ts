import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { initializeSyncSchema } from './sync-schema';
import { exchangeUserData } from './server-user-sync';
import { OnlineAccountClient, type AccountTransport } from './account-data-client';
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
  it('写入真正确认前不改变内存；冲突采用服务器内容并报告失败', async () => {
    const normal = new OnlineAccountClient('a', transport); await normal.write([progress(20)]);
    let release!: () => void; let reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const entered = new Promise<void>((resolve) => { reached = resolve; });
    const delayed = new OnlineAccountClient('a', async (request) => { if (request.mutations.length) { reached(); await gate; } return transport(request); });
    await delayed.refresh();
    const writing = delayed.write([progress(70)]); await entered;
    expect(delayed.get('progress', 's_film_0')).toMatchObject({ position: 20 });
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
