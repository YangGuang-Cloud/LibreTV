import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

describe('搜索并发控制', () => {
  it('最多同时执行指定数量，结果保留输入顺序', async () => {
    let active = 0;
    let max = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 5 - value));
      active--;
      return value * 2;
    });
    expect(max).toBe(2);
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });
  it('中断后不启动剩余任务', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await expect(mapWithConcurrency([1, 2, 3], 1, async (value) => {
      started.push(value);
      controller.abort();
      return value;
    }, controller.signal)).rejects.toThrow();
    expect(started).toEqual([1]);
  });
});
