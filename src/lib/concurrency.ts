/** 有界并发，保留输入顺序；取消后不启动剩余任务。 */
export async function mapWithConcurrency<T, R>(
  items: T[], limit: number, run: (item: T, index: number) => Promise<R>, signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      signal?.throwIfAborted();
      const index = cursor++;
      results[index] = await run(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}
