import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startViewerActivity, stopViewerActivity, trackVideoActivity } from './viewer-activity';
import type { ActivityReport } from './account-activity';
let reports: ActivityReport[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('crypto', { randomUUID: () => 'producer-web-123456' });
  reports = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => { reports.push(JSON.parse(options.body as string)); return { ok: true }; }));
});
afterEach(() => { stopViewerActivity(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('网页上报实际播放秒数，暂停与离开页面后变为在线／离线，不依赖影片进度', async () => {
  startViewerActivity('a');
  const media = Object.assign(new EventTarget(), { currentTime: 0, playbackRate: 2, paused: false, ended: false, seeking: false, readyState: 4 });
  const detach = trackVideoActivity(media as unknown as HTMLVideoElement);
  for (let i = 0; i < 21; i++) { media.currentTime += 2; await vi.advanceTimersByTimeAsync(1000); }
  expect(reports.at(-1)).toMatchObject({ accountId: 'a', state: 'watching', watchedMs: 19000 });
  media.paused = true; media.dispatchEvent(new Event('pause'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(reports.at(-1)).toMatchObject({ state: 'online', watchedMs: 20000 });
  detach(); stopViewerActivity();
  expect(reports.at(-1)).toMatchObject({ state: 'offline', watchedMs: 20000 });
});
it('账号切换后重新建立计数，不将上一个账号的计数上报给新账号', async () => {
  startViewerActivity('a'); await vi.advanceTimersByTimeAsync(1000);
  startViewerActivity('b'); await vi.advanceTimersByTimeAsync(1000);
  expect(reports.at(-1)).toMatchObject({ accountId: 'b', state: 'online', watchedMs: 0, sequence: 1 });
  expect(reports.find((report) => report.accountId === 'a' && report.state === 'offline')).toBeTruthy();
});
it('不支持设备生成标识时也不影响网页启动', () => {
  vi.stubGlobal('crypto', {});
  expect(() => startViewerActivity('a')).not.toThrow();
  expect(reports).toHaveLength(0);
});
