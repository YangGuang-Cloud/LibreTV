import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getEnvSources } from './env-sources';
import { parseSourceConfig } from './source-config';
import type { SourceConfig } from './types';

export function serverSourceMode(): boolean {
  return process.env.SOURCE_MODE === 'server';
}

export interface ServerSources {
  sources: SourceConfig[];
  revision: string;
}

export function normalizeServerSources(value: unknown): SourceConfig[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('点播源必须为数组，最多 50 个');
  const sources = value.map(parseSourceConfig);
  if (sources.some((source) => !source)) throw new Error('点播源配置无效');
  const result = sources as SourceConfig[];
  if (new Set(result.map((source) => source.key)).size !== result.length) throw new Error('点播源编号重复');
  if (new Set(result.map((source) => source.url)).size !== result.length) throw new Error('点播源地址重复');
  return result;
}

function snapshot(sources: SourceConfig[]): ServerSources {
  return { sources, revision: createHash('sha256').update(JSON.stringify(sources)).digest('hex') };
}

function sourcesPath(): string {
  return path.join(process.env.SERVER_DATA_DIR || path.join(process.cwd(), '.data'), 'sources.json');
}

/** 无文件时使用环境预置；空数组是有效配置，不能退回环境预置恢复已删除的源。 */
export async function readServerSources(): Promise<ServerSources> {
  try {
    const value = JSON.parse(await readFile(sourcesPath(), 'utf8')) as { sources?: unknown };
    return snapshot(normalizeServerSources(value?.sources));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return snapshot(normalizeServerSources(getEnvSources()));
    throw error;
  }
}

export class SourceRevisionConflict extends Error {}

// 单实例内串行写入 + 乐观版本检查，防止两个管理员互相覆盖。
let writes: Promise<unknown> = Promise.resolve();
export function saveServerSources(sources: SourceConfig[], revision: string): Promise<ServerSources> {
  const next = normalizeServerSources(sources);
  const operation = writes.then(async () => {
    const current = await readServerSources();
    if (revision !== current.revision) throw new SourceRevisionConflict('配置已被更新，请重新加载后编辑');
    const target = sourcesPath();
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ version: 1, sources: next }, null, 2), { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } finally {
      await unlink(temp).catch(() => {});
    }
    return snapshot(next);
  });
  writes = operation.catch(() => {});
  return operation;
}

/** 客户端提交编号，服务端决定真实接口；客户端提供的 URL/名称/成人标记不参与决策。 */
export async function resolveServerSources(keys?: unknown): Promise<SourceConfig[]> {
  const { sources } = await readServerSources();
  if (keys === undefined) return sources;
  if (!Array.isArray(keys) || keys.length > 50 || keys.some((key) => typeof key !== 'string')) {
    throw new Error('源编号列表无效');
  }
  const byKey = new Map(sources.map((source) => [source.key, source]));
  return [...new Set(keys as string[])].map((key) => {
    const source = byKey.get(key);
    if (!source) throw new Error('源已更新，请刷新源列表');
    return source;
  });
}
