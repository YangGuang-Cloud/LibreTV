import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultRecommendationConfig, normalizeRecommendationConfig, type RecommendationConfig, type RecommendationSnapshot } from './recommendation-config';
import { getEnvRecommendSource } from './env-recommend-source';

const configPath = () => path.join(process.env.SERVER_DATA_DIR || path.join(process.cwd(), '.data'), 'recommendations.json');
function snapshot(config: RecommendationConfig): RecommendationSnapshot {
  return { ...config, revision: createHash('sha256').update(JSON.stringify(config)).digest('hex') };
}
export async function readRecommendations(): Promise<RecommendationSnapshot> {
  try { return snapshot(normalizeRecommendationConfig(JSON.parse(await readFile(configPath(), 'utf8')))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return snapshot(defaultRecommendationConfig(getEnvRecommendSource()));
    throw error;
  }
}
export class RecommendationRevisionConflict extends Error {}
let writes: Promise<unknown> = Promise.resolve();
export function saveRecommendations(value: unknown, revision: string): Promise<RecommendationSnapshot> {
  const next = normalizeRecommendationConfig(value);
  const operation = writes.then(async () => {
    if ((await readRecommendations()).revision !== revision) throw new RecommendationRevisionConflict('配置已被更新，请重新加载后编辑');
    const target = configPath();
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ version: 1, ...next }, null, 2), { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } finally { await unlink(temp).catch(() => {}); }
    return snapshot(next);
  });
  writes = operation.catch(() => {});
  return operation;
}
