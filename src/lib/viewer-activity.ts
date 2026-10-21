'use client';
import { PlaybackTime } from './playback-time';
import type { ActivityReport, ActivityState } from './account-activity';
let current: ViewerActivity | null = null;

class ViewerActivity {
  private producerId = crypto.randomUUID();
  private sequence = 0;
  private watchedMs = 0;
  private lastSent = -Infinity;
  private sending = false;
  private pending = false;
  private stopped = false;
  private videos = new Map<HTMLVideoElement, { clock: PlaybackTime; progressedAt: number; cleanup: () => void }>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private accountId: string) {
    this.timer = setInterval(() => this.tick(), 1000);
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pageHide);
    this.flush();
  }
  private visibility = () => { this.tick(); this.flush(true); };
  private pageHide = () => this.flush(true, 'offline');
  track(video: HTMLVideoElement) {
    const row = { clock: new PlaybackTime(), progressedAt: -Infinity, cleanup: () => {} };
    const changed = () => { row.clock.reset(); row.progressedAt = -Infinity; this.flush(); };
    const events = ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended', 'emptied'];
    events.forEach((event) => video.addEventListener(event, changed));
    row.cleanup = () => events.forEach((event) => video.removeEventListener(event, changed));
    this.videos.set(video, row);
    return () => { row.cleanup(); this.videos.delete(video); this.flush(); };
  }
  private state(): ActivityState {
    const now = performance.now();
    if ([...this.videos.entries()].some(([video, row]) => !video.paused && !video.ended && !video.seeking && now - row.progressedAt < 5000)) return 'watching';
    return document.visibilityState === 'visible' ? 'online' : 'offline';
  }
  private tick() {
    if (this.stopped) return;
    const now = performance.now();
    for (const [video, row] of this.videos) {
      const delta = row.clock.sample(now, video.currentTime, video.playbackRate, !video.paused && !video.ended && !video.seeking && video.readyState >= 3);
      if (delta > 0) { this.watchedMs += delta; row.progressedAt = now; }
    }
    if (now - this.lastSent >= 20_000 || (this.pending && !this.sending && now - this.lastSent >= 1000)) this.flush();
  }
  private flush(keepalive = false, override?: ActivityState) {
    if (this.stopped) return;
    if (!keepalive && (this.sending || performance.now() - this.lastSent < 1000)) { this.pending = true; return; }
    this.pending = false;
    const report: ActivityReport = { accountId: this.accountId, producerId: this.producerId, sequence: ++this.sequence, watchedMs: Math.floor(this.watchedMs), state: override ?? this.state() };
    this.lastSent = performance.now();
    this.sending = true;
    void fetch('/api/user/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), cache: 'no-store', keepalive })
      .catch(() => { /* Telemetry never blocks playback or creates an offline outbox. */ })
      .finally(() => { this.sending = false; if (this.pending && !this.stopped) { this.pending = false; this.flush(); } });
  }
  stop() {
    this.tick(); this.flush(true, 'offline'); this.stopped = true;
    clearInterval(this.timer); document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('pagehide', this.pageHide);
    for (const row of this.videos.values()) row.cleanup();
    this.videos.clear();
  }
}
export function startViewerActivity(accountId: string) {
  stopViewerActivity();
  try { current = new ViewerActivity(accountId); } catch { current = null; }
}
export function stopViewerActivity() { current?.stop(); current = null; }
export function trackVideoActivity(video: HTMLVideoElement) { return current?.track(video) ?? (() => {}); }
