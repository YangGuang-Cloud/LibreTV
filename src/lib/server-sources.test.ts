import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readServerSources, resolveServerSources, saveServerSources } from './server-sources';

let dir: string;
const source = { key: 'server_a', name: '源 A', url: 'https://8.8.8.8/api' };
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'libretv-sources-'));
  vi.stubEnv('SERVER_DATA_DIR', dir);
  vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '预置', url: 'https://1.1.1.1/api' }]));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe('服务器源持久化', () => {
  it('首次读取使用环境预置，保存后从磁盘读回', async () => {
    const initial = await readServerSources();
    expect(initial.sources[0].name).toBe('预置');
    const saved = await saveServerSources([source], initial.revision);
    expect(await readServerSources()).toEqual(saved);
    expect((await resolveServerSources(['server_a']))[0]).toEqual({ ...source, isAdult: false });
  });
  it('删除全部源后空配置保持，不恢复环境源', async () => {
    await saveServerSources([], (await readServerSources()).revision);
    expect((await readServerSources()).sources).toEqual([]);
  });
  it('并发提交同一旧版本只有一个成功，避免覆盖', async () => {
    const { revision } = await readServerSources();
    const results = await Promise.allSettled([
      saveServerSources([source], revision), saveServerSources([], revision),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((await readServerSources()).sources[0].key).toBe('server_a');
  });
  it('损坏配置拒绝读取，不静默恢复或覆盖', async () => {
    await writeFile(path.join(dir, 'sources.json'), '{broken');
    await expect(readServerSources()).rejects.toThrow();
  });
  it('非法源、重复编号和未知编号被拒绝', async () => {
    const { revision } = await readServerSources();
    expect(() => saveServerSources([source, source], revision)).toThrow('重复');
    expect(() => saveServerSources([null] as never, revision)).toThrow('无效');
    await expect(resolveServerSources(['unknown'])).rejects.toThrow('已更新');
  });
});
