import { rmsLevel, smoothLevel, visualLevel } from "./voice-levels.ts";

/** Complete signed little-endian samples, including network chunks split inside a sample. */
export class PCM16Decoder {
  private carry: number | null = null;
  decode(bytes: Uint8Array): Float32Array {
    const count = Math.floor((bytes.length + (this.carry === null ? 0 : 1)) / 2);
    const output = new Float32Array(count); let offset = 0, index = 0;
    const signed = (low: number, high: number) => { const value = low | high << 8; return (value >= 32768 ? value - 65536 : value) / 32768; };
    if (this.carry !== null && bytes.length) { output[index++] = signed(this.carry, bytes[offset++]!); this.carry = null; }
    while (offset + 1 < bytes.length) { output[index++] = signed(bytes[offset]!, bytes[offset + 1]!); offset += 2; }
    if (offset < bytes.length) this.carry = bytes[offset]!;
    return output;
  }
  finish() { if (this.carry !== null) throw new Error("不完整的语音采样"); }
}

interface Options { onStart(): void; onLevel(level: number): void }
/** One bounded graph for one short narration. Incoming audio can play before synthesis ends. */
export class PCMStreamPlayer {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  private context: AudioContext;
  private analyser: AnalyserNode;
  private decoder = new PCM16Decoder();
  private sources = new Set<AudioBufferSourceNode>();
  private pending = new Float32Array(480); // Coalesce tiny network frames into at least 20 ms of audio.
  private pendingSamples = 0;
  private nextAt = 0;
  private firstAt: number | null = null;
  private ended = false;
  private stopped = false;
  private began = false;
  private startTimer?: ReturnType<typeof setTimeout>;
  private meterTimer?: ReturnType<typeof setInterval>;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private cancelReady?: () => void;
  private resolveFinished!: () => void;
  private options: Options;
  constructor(options: Options, createContext = () => new AudioContext({ sampleRate: 24000 })) {
    this.options = options; this.context = createContext();
    this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
    this.analyser.connect(this.context.destination);
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    this.ready = Promise.race([
      this.context.resume(),
      new Promise<void>(resolve => { this.cancelReady = resolve; this.readyTimer = setTimeout(resolve, 350); }),
    ]).then(() => {
      clearTimeout(this.readyTimer); this.cancelReady = undefined;
      if (!this.stopped && this.context.state !== "running") throw new Error("语音播放尚未获得授权");
    });
    // Consumers may be awaiting network headers when the audio context fails.
    void this.ready.catch(() => {});
  }
  // Audio runs on its own clock. A busy renderer can delay onStart after samples are already audible.
  get started() { return this.began || this.firstAt !== null && this.context.currentTime >= this.firstAt; }
  append(bytes: Uint8Array) {
    if (this.stopped || this.ended) return;
    const samples = this.decoder.decode(bytes); if (!samples.length) return;
    const duration = samples.length / 24000;
    if (duration + this.pendingSamples / 24000 + Math.max(0, this.nextAt - this.context.currentTime) > 60) throw new Error("语音缓冲超出上限");
    let offset = 0;
    if (this.pendingSamples) {
      const take = Math.min(samples.length, this.pending.length - this.pendingSamples);
      this.pending.set(samples.subarray(0, take), this.pendingSamples); this.pendingSamples += take; offset += take;
      if (this.pendingSamples === this.pending.length) { this.schedule(this.pending); this.pendingSamples = 0; }
    }
    if (samples.length - offset >= this.pending.length) this.schedule(samples.subarray(offset));
    else if (offset < samples.length) { this.pending.set(samples.subarray(offset), this.pendingSamples); this.pendingSamples += samples.length - offset; }
  }
  private schedule(samples: Float32Array) {
    const duration = samples.length / 24000;
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.analyser);
    const startAt = Math.max(this.context.currentTime + (this.nextAt ? .015 : .06), this.nextAt);
    this.nextAt = startAt + duration; this.sources.add(source);
    source.onended = () => { source.disconnect(); this.sources.delete(source); if (this.ended && !this.sources.size) this.dispose(); };
    source.start(startAt);
    if (this.firstAt === null) this.firstAt = startAt;
    if (!this.startTimer && !this.began) this.startTimer = setTimeout(() => {
      this.startTimer = undefined;
      if (this.stopped) return;
      this.began = true; this.options.onStart(); this.startMeter();
    }, Math.max(0, (startAt - this.context.currentTime) * 1000));
  }
  private startMeter() {
    const samples = new Float32Array(512); let level = 0, published = 0;
    this.meterTimer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(samples);
      level = smoothLevel(level, visualLevel(rmsLevel(samples)), 100);
      if (Math.abs(level - published) >= .01 || level === 0 && published !== 0) { published = level; this.options.onLevel(level); }
    }, 100);
  }
  end() {
    if (this.stopped || this.ended) return;
    this.decoder.finish();
    if (this.pendingSamples) { this.schedule(this.pending.subarray(0, this.pendingSamples)); this.pendingSamples = 0; }
    this.ended = true; if (!this.sources.size) this.dispose();
  }
  dispose() {
    if (this.stopped) return;
    this.began = this.started;
    this.stopped = true; this.pendingSamples = 0; clearTimeout(this.startTimer); clearTimeout(this.readyTimer); clearInterval(this.meterTimer); this.cancelReady?.();
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    this.sources.clear(); this.analyser.disconnect();
    if (this.context.state !== "closed") void this.context.close().catch(() => {});
    this.options.onLevel(0); this.resolveFinished();
  }
}
