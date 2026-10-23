/** Relative visual loudness, not calibrated sound-pressure measurement. Silence remains exactly zero. */
export function rmsLevel(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Number.isFinite(samples[i]) ? samples[i]! : 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}
export function visualLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0.0018) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 55) / 43));
}
export function smoothLevel(previous: number, next: number, elapsedMs = 50): number {
  const duration = next > previous ? 55 : 180;
  const value = previous + (next - previous) * (1 - Math.exp(-Math.max(0, elapsedMs) / duration));
  return value < 0.002 ? 0 : Math.max(0, Math.min(1, value));
}

/** Exactly one output route: the existing HTMLAudioElement -> analyser -> destination. */
export class PlaybackLevelMeter {
  readonly ready: Promise<void>;
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private settleResume: (() => void) | null = null;
  private disposed = false;
  private level = 0;
  private published = 0;
  private notify: (level: number) => void;
  constructor(player: HTMLAudioElement, notify: (level: number) => void, createContext = () => new AudioContext()) {
    this.notify = notify;
    this.ready = this.prepare(player, createContext);
  }
  private async prepare(player: HTMLAudioElement, createContext: () => AudioContext) {
    try {
      const context = createContext(); this.context = context;
      // Do not bind the media element before the context can run. If autoplay blocks Web Audio,
      // the original element retains normal HTML audio playback without an analyser or fake level.
      await Promise.race([
        context.resume(),
        new Promise<void>(resolve => { this.settleResume = resolve; this.resumeTimer = setTimeout(resolve, 300); }),
      ]);
      if (this.resumeTimer) clearTimeout(this.resumeTimer); this.resumeTimer = null; this.settleResume = null;
      if (this.disposed || context.state !== "running") { this.dispose(); return; }
      const analyser = context.createAnalyser(); this.analyser = analyser; analyser.fftSize = 512;
      analyser.connect(context.destination);
      const source = context.createMediaElementSource(player); this.source = source;
      source.connect(analyser);
    } catch { this.dispose(); }
  }
  start() {
    if (this.disposed || !this.analyser || this.interval) return;
    const samples = new Float32Array(this.analyser.fftSize);
    this.interval = setInterval(() => {
      if (this.disposed || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(samples);
      this.level = smoothLevel(this.level, visualLevel(rmsLevel(samples)), 100);
      if (Math.abs(this.level - this.published) >= .01 || this.level === 0 && this.published !== 0) {
        this.published = this.level; this.notify(this.level);
      }
    }, 100);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.interval) clearInterval(this.interval); this.interval = null;
    if (this.resumeTimer) clearTimeout(this.resumeTimer); this.resumeTimer = null;
    this.settleResume?.(); this.settleResume = null;
    this.source?.disconnect(); this.source = null;
    this.analyser?.disconnect(); this.analyser = null;
    const context = this.context; this.context = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
    this.notify(0);
  }
}
