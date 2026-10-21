import { expect, it } from 'vitest';
import { PlaybackTime } from './playback-time';
it('2倍速只计实际经过时间，暂停、缓冲、拖动和长挂起不计', () => {
  const clock = new PlaybackTime();
  expect(clock.sample(0, 0, 2, true)).toBe(0);
  expect(clock.sample(1000, 2, 2, true)).toBe(1000);
  expect(clock.sample(2000, 2, 2, true)).toBe(0);
  expect(clock.sample(3000, 500, 2, true)).toBe(0);
  expect(clock.sample(4000, 0, 2, true)).toBe(0);
  expect(clock.sample(5000, 0, 2, false)).toBe(0);
  expect(clock.sample(6000, 2, 2, true)).toBe(0);
  expect(clock.sample(16000, 22, 2, true)).toBe(0);
  clock.reset();
  expect(clock.sample(17000, 200, 1, true)).toBe(0);
});
