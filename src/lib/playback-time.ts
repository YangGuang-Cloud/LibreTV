/** Count observed playback wall time, never a seek distance or a long unsampled gap. */
export class PlaybackTime {
  private previous: { at: number; position: number; rate: number; playing: boolean } | null = null;
  reset() { this.previous = null; }
  sample(at: number, position: number, rate: number, playing: boolean): number {
    const previous = this.previous;
    this.previous = { at, position, rate, playing };
    if (!previous || !playing || !previous.playing || !Number.isFinite(position) || !Number.isFinite(rate) || rate <= 0 || rate !== previous.rate) return 0;
    const elapsed = at - previous.at; const advance = position - previous.position;
    if (elapsed <= 0 || elapsed > 5000 || advance <= 0 || advance > elapsed / 1000 * rate + 0.5) return 0;
    return Math.min(elapsed, advance / rate * 1000);
  }
}
