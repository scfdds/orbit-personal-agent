import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { HttpError } from "./store.ts";
import { modelConfigurationPath } from "./model-config.ts";
import type { VoiceConfigurationState, VoiceTranscription } from "../shared/voice.ts";

const DEFAULT_VOICE = "zh_female_xiaohe_jupiter_bigtts";
const PROVIDER = "doubao-realtime" as const;
const ENDPOINT = "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue";
export const VOICE_INPUT_LIMIT = 2 * 1024 * 1024;
const OUTPUT_LIMIT = 8 * 1024 * 1024;
const STREAM_HIGH_WATER = 64 * 1024;
const STREAM_LOW_WATER = 32 * 1024;
const STREAM_BUFFER_LIMIT = 256 * 1024;
type AudioFlowControl = { pause(): void; resume(): void };
type PCMConsumer = { write(chunk: Buffer): void; setFlowControl(control: AudioFlowControl): void };
export interface VoicePCMStream {
  readonly format: "pcm_s16le";
  readonly sampleRate: 24000;
  readonly channels: 1;
  /** Single-consumer PCM stream. The first chunk is retained; iterator.return() cancels upstream. */
  chunks: AsyncIterable<Buffer>;
  cancel(): void;
}
type Verification = { fingerprint: string; tts?: boolean; asr?: boolean };
type Configuration = { apiKey: string; voice: string; verification?: Verification };
type Event = Record<string, any>;
export function voiceConfigurationPath() { return resolve(process.env.ORBIT_VOICE_CONFIG_PATH || resolve(dirname(modelConfigurationPath()), "voice-config.json")); }
const identity = (config: Configuration) => createHash("sha256").update(JSON.stringify([PROVIDER, config.apiKey, config.voice])).digest("hex");
function readConfiguration(): Configuration {
  const path = voiceConfigurationPath();
  if (!existsSync(path)) return { apiKey: "", voice: DEFAULT_VOICE };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.apiKey !== "string") throw new Error();
    return { apiKey: parsed.apiKey, voice: typeof parsed.voice === "string" && parsed.voice ? parsed.voice : DEFAULT_VOICE, verification: parsed.verification };
  } catch { throw new HttpError(503, "语音配置无法读取，请重新保存语音设置"); }
}
function writeConfiguration(config: Configuration) {
  const path = voiceConfigurationPath(), temporary = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, JSON.stringify(config), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path); chmodSync(path, 0o600);
  } catch { throw new HttpError(503, "无法保存语音设置，请检查用户数据目录"); }
  finally { rmSync(temporary, { force: true }); }
}
export function voiceConfigurationState(): VoiceConfigurationState {
  let config: Configuration;
  try { config = readConfiguration(); } catch { config = { apiKey: "", voice: DEFAULT_VOICE }; }
  const verified = config.verification?.fingerprint === identity(config) ? config.verification : undefined;
  return { configured: Boolean(config.apiKey), tts: Boolean(config.apiKey && verified?.tts !== false), asr: Boolean(config.apiKey && verified?.asr !== false), streamingTts: true, verified: { tts: verified?.tts === true, asr: verified?.asr === true }, provider: PROVIDER, voice: config.voice };
}
export function saveVoiceConfiguration(input: Record<string, unknown>): VoiceConfigurationState {
  if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || !input.apiKey.trim() || input.apiKey.length > 512 || /[\r\n]/.test(input.apiKey))) throw new HttpError(400, "请输入有效的语音 API Key");
  if (input.voice !== undefined && (typeof input.voice !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(input.voice))) throw new HttpError(400, "音色标识无效");
  if (input.clear !== undefined && typeof input.clear !== "boolean") throw new HttpError(400, "语音配置操作无效");
  if (input.clear === true && input.apiKey !== undefined) throw new HttpError(400, "不能同时清除和设置语音密钥");
  let previous: Configuration;
  try { previous = readConfiguration(); } catch { previous = { apiKey: "", voice: DEFAULT_VOICE }; }
  const next: Configuration = { apiKey: input.clear === true ? "" : typeof input.apiKey === "string" ? input.apiKey.trim() : previous.apiKey, voice: typeof input.voice === "string" ? input.voice : previous.voice };
  if (identity(next) === identity(previous) && previous.verification) next.verification = { fingerprint: identity(next), ...(previous.verification.tts === true ? { tts: true } : {}), ...(previous.verification.asr === true ? { asr: true } : {}) };
  writeConfiguration(next);
  return voiceConfigurationState();
}
function markCapability(config: Configuration, kind: "tts" | "asr", available: boolean) {
  const latest = readConfiguration();
  if (identity(latest) !== identity(config)) return; // An old in-flight request cannot validate a newly entered key.
  const old = latest.verification?.fingerprint === identity(latest) ? latest.verification : {};
  latest.verification = { ...old, fingerprint: identity(latest), [kind]: available };
  writeConfiguration(latest);
}

/** WAV containers are parsed rather than assuming a fixed 44-byte header. */
export function parseVoiceWav(wav: Buffer): Buffer {
  if (!Buffer.isBuffer(wav) || wav.length > VOICE_INPUT_LIMIT) throw new HttpError(413, "录音不能超过 2 MB");
  const invalid = () => new HttpError(400, "录音需要 16 kHz、单声道、PCM16 的 WAV 音频");
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE" || wav.readUInt32LE(4) + 8 !== wav.length) throw invalid();
  let format = false, pcm: Buffer | undefined;
  for (let offset = 12; offset < wav.length;) {
    if (offset + 8 > wav.length) throw invalid();
    const kind = wav.toString("ascii", offset, offset + 4), size = wav.readUInt32LE(offset + 4), begin = offset + 8, end = begin + size;
    if (end > wav.length) throw invalid();
    if (kind === "fmt ") {
      if (format || size < 16 || wav.readUInt16LE(begin) !== 1 || wav.readUInt16LE(begin + 2) !== 1 || wav.readUInt32LE(begin + 4) !== 16000 || wav.readUInt32LE(begin + 8) !== 32000 || wav.readUInt16LE(begin + 12) !== 2 || wav.readUInt16LE(begin + 14) !== 16) throw invalid();
      format = true;
    } else if (kind === "data") { if (pcm) throw invalid(); pcm = wav.subarray(begin, end); }
    offset = end + (size % 2);
  }
  if (!format || !pcm?.length || pcm.length % 2) throw invalid();
  if (pcm.length > 16000 * 2 * 60) throw new HttpError(413, "录音不能超过 60 秒");
  return pcm;
}
export function voiceWav(pcm: Buffer, rate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export function voiceProviderError(detail: string): HttpError {
  // Do not pass upstream prose, event payloads, or handshake headers to the client or logs.
  if (/401|403|unauthori[sz]ed|forbidden|auth|invalid.*(?:key|token)|鉴权|权限/i.test(detail)) return new HttpError(502, "豆包语音鉴权失败，请确认密钥有效并已开通实时语音 3.0");
  if (/429|quota|balance|billing|concurren|余额|配额|欠费/i.test(detail)) return new HttpError(502, "豆包语音额度或并发不足，请检查服务配额");
  if (/invalidspeaker|parameter|argument|音色|参数/i.test(detail)) return new HttpError(502, "豆包语音参数不受支持，请检查音色设置");
  return new HttpError(502, "豆包语音服务暂不可用，请稍后重试");
}

/** Bounded PCM queue: HTTP consumers drive upstream WebSocket pause/resume through iteration. */
class PCMQueue implements PCMConsumer {
  private buffers: Buffer[] = [];
  private bytes = 0;
  private ended = false;
  private error?: Error;
  private flow?: AudioFlowControl;
  private paused = false;
  private wake?: () => void;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  readonly ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
  setFlowControl(control: AudioFlowControl) { this.flow = control; }
  write(chunk: Buffer) {
    if (this.ended || this.error || !chunk.length) return;
    if (this.bytes + chunk.length > STREAM_BUFFER_LIMIT) throw new HttpError(502, "语音播放连接过慢，请重试");
    this.buffers.push(chunk); this.bytes += chunk.length;
    if (!this.paused && this.bytes >= STREAM_HIGH_WATER) { this.paused = true; this.flow?.pause(); }
    this.resolveReady(); this.wake?.();
  }
  end() { this.ended = true; this.wake?.(); }
  throwIfFailed() { if (this.error) throw this.error; }
  fail(error: Error) {
    if (this.error) return;
    this.error = error; this.buffers = []; this.bytes = 0;
    if (this.paused) { this.paused = false; this.flow?.resume(); }
    this.rejectReady(error); this.wake?.();
  }
  async next(): Promise<IteratorResult<Buffer>> {
    while (!this.error && !this.buffers.length && !this.ended) await new Promise<void>(resolve => { this.wake = resolve; });
    this.wake = undefined;
    if (this.error) throw this.error;
    const chunk = this.buffers.shift();
    if (!chunk) return { value: undefined, done: true };
    this.bytes -= chunk.length;
    if (this.paused && this.bytes <= STREAM_LOW_WATER) { this.paused = false; this.flow?.resume(); }
    return { value: chunk, done: false };
  }
}

/** Uses the same official Seeduplex protocol as the verified Swan adapter. No Agent tools or session history. */
export class DoubaoVoiceAdapter {
  private endpoint: string;
  constructor(options: { endpoint?: string; timeoutMs?: number; onEvent?: (type: string) => void } = {}) {
    this.options = options;
    this.endpoint = options.endpoint || ENDPOINT;
    if (this.endpoint !== ENDPOINT && !/^ws:\/\/(127\.0\.0\.1|localhost):\d+(?:\/|$)/.test(this.endpoint)) throw new Error("语音测试接口仅允许本机地址");
  }
  private options: { timeoutMs?: number; onEvent?: (type: string) => void };
  async perform(config: Configuration, input: { text: string } | { pcm: Buffer }, signal: AbortSignal): Promise<Buffer | string> {
    return this.run(config, input, signal) as Promise<Buffer | string>;
  }
  /** Server-only streaming sink; no WAV header and no duplicate accumulation of complete audio. */
  async performPCM(config: Configuration, text: string, signal: AbortSignal, sink: PCMConsumer): Promise<void> {
    await this.run(config, { text }, signal, sink);
  }
  private async run(config: Configuration, input: { text: string } | { pcm: Buffer }, signal: AbortSignal, sink?: PCMConsumer): Promise<Buffer | string | void> {
    if (signal.aborted) throw new HttpError(499, "语音请求已取消");
    const tts = "text" in input;
    return new Promise((resolveResult, rejectResult) => {
      let completed = false, ready = false, audioBytes = 0, feedingDone = false, transcriptCompleted = false;
      const audio: Buffer[] = [], transcripts = new Map<string, string>();
      let currentItem = "first", pendingByte: Buffer | undefined;
      const sending = new AbortController();
      const socket = new WebSocket(this.endpoint, { headers: { "X-Api-Key": config.apiKey }, handshakeTimeout: 15000, maxPayload: 1024 * 1024, perMessageDeflate: false, followRedirects: false });
      const timer = setTimeout(() => finish(new HttpError(504, "语音请求超时，请稍后重试")), this.options.timeoutMs ?? (tts ? 60000 : 85000));
      const send = (event: Event) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event_id: randomUUID(), ...event })); };
      const finish = (error?: Error, value?: Buffer | string) => {
        if (completed) return;
        completed = true; clearTimeout(timer); sending.abort(); signal.removeEventListener("abort", cancelled);
        const complete = () => error ? rejectResult(error) : resolveResult(value!);
        if (socket.readyState === WebSocket.OPEN && ready) {
          socket.resume(); // A cancelled slow consumer must not prevent provider teardown.
          if (!tts) send({ type: "response.cancel" });
          send({ type: "session.close" });
          const closer = setTimeout(() => socket.terminate(), 750);
          closer.unref();
          socket.once("close", () => clearTimeout(closer));
          // The complete audio/transcript is ready. Provider teardown must not delay playback.
          complete();
        } else { socket.terminate(); complete(); }
      };
      const cancelled = () => finish(new HttpError(499, "语音请求已取消"));
      signal.addEventListener("abort", cancelled, { once: true });
      sink?.setFlowControl({ pause: () => { if (!completed) socket.pause(); }, resume: () => { if (!completed) socket.resume(); } });
      const completeTranscript = () => {
        const text = [...transcripts.values()].filter(Boolean).join("").trim();
        if (!text) finish(new HttpError(422, "没有听清录音，请重试"));
        else finish(undefined, text);
      };
      const settleTranscript = () => {
        if (feedingDone && transcriptCompleted) completeTranscript();
      };
      socket.on("open", () => send({ type: "session.create", session: {
        model: "1.2.6.1", instructions: "你只负责语音转写或朗读指定文本，不回答问题，不执行任务，不改写或补充指定文本。", tools: [],
        audio: { input: { format: { type: "pcm", rate: 16000 } }, output: { format: { type: "pcm_s16le", rate: 24000 }, voice: config.voice } },
      } }));
      socket.on("message", (data, binary) => {
        let event: Event;
        try { if (binary) throw new Error(); event = JSON.parse(data.toString()); if (!event || typeof event.type !== "string") throw new Error(); }
        catch { finish(new HttpError(502, "豆包语音返回了无效数据")); return; }
        this.options.onEvent?.(event.type);
        if (event.type === "session.closed") { socket.close(1000); return; }
        if (completed) return;
        if (event.type === "error") { finish(voiceProviderError(JSON.stringify(event))); return; }
        if (event.type === "session.created" && !ready) {
          ready = true; send({ type: "input_audio_mute.commit" });
          if ("text" in input) send({ type: "speech_text_buffer.commit", text: input.text });
          else void (async () => {
            send({ type: "input_audio_unmute.commit" });
            // Upstream requires real-time pacing; never burst a complete recording into its input buffer.
            for (let offset = 0; offset < input.pcm.length; offset += 640) {
              if (sending.signal.aborted) return;
              send({ type: "input_audio_buffer.append", audio: input.pcm.subarray(offset, offset + 640).toString("base64") });
              await delay(20, undefined, { signal: sending.signal });
            }
            feedingDone = true; send({ type: "input_audio_buffer.commit" }); send({ type: "input_audio_mute.commit" }); settleTranscript();
          })().catch(() => { if (!completed) finish(new HttpError(502, "语音发送失败，请重试")); });
        }
        if (tts && event.type === "response.output_audio.delta") {
          const encoded = event.delta ?? event.audio;
          if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) { finish(new HttpError(502, "豆包语音音频格式无效")); return; }
          const chunk = Buffer.from(encoded, "base64"); audioBytes += chunk.length;
          if (audioBytes > OUTPUT_LIMIT) { finish(new HttpError(502, "合成语音过长，请缩短文本")); return; }
          if (sink) {
            const pcm = pendingByte ? Buffer.concat([pendingByte, chunk]) : chunk;
            pendingByte = pcm.length % 2 ? pcm.subarray(-1) : undefined;
            try { sink.write(pcm.subarray(0, pcm.length - (pcm.length % 2))); }
            catch { finish(new HttpError(502, "语音播放连接过慢，请重试")); }
          } else audio.push(chunk);
        }
        if (tts && event.type === "response.output_audio.done") {
          if (!audioBytes || audioBytes % 2) finish(new HttpError(502, "豆包语音没有返回完整音频"));
          else finish(undefined, sink ? undefined : voiceWav(Buffer.concat(audio)));
        }
        if (!tts) {
          if (event.type === "response.output_audio.started") send({ type: "response.cancel" });
          if (event.type === "conversation.item.input_audio_transcription.started") {
            currentItem = String(event.item_id || randomUUID()); transcriptCompleted = false;
          }
          if (["conversation.item.input_audio_transcription.delta", "conversation.item.input_audio_transcription.completed"].includes(event.type)) {
            const value = event.transcript ?? event.text ?? event.delta;
            if (typeof value === "string" && value.trim()) transcripts.set(String(event.item_id || currentItem), value.trim());
            transcriptCompleted = event.type === "conversation.item.input_audio_transcription.completed";
            settleTranscript();
          }
          if (event.type === "conversation.item.input_audio_transcription.failed") finish(new HttpError(422, "录音转写失败，请重试"));
        }
      });
      socket.on("error", error => finish(voiceProviderError(error.message)));
      socket.on("close", () => { if (!completed) finish(new HttpError(502, "语音连接提前断开，请重试")); });
    });
  }
}

export class VoiceService {
  private active = new Set<AbortController>();
  private adapter: DoubaoVoiceAdapter;
  constructor(adapter = new DoubaoVoiceAdapter()) { this.adapter = adapter; }
  async synthesize(text: unknown, signal?: AbortSignal): Promise<Buffer> {
    if (typeof text !== "string" || !text.trim() || text.length > 1200) throw new HttpError(400, "朗读文本需为 1–1200 个字符");
    return this.perform("tts", { text: text.trim() }, signal) as Promise<Buffer>;
  }
  /** Resolves only after the first PCM sample, so initial errors can still be regular HTTP errors.
   * After any audio has been delivered, errors must end playback, never restart the full sentence.
   */
  async synthesizeStream(text: unknown, signal?: AbortSignal): Promise<VoicePCMStream> {
    if (typeof text !== "string" || !text.trim() || text.length > 1200) throw new HttpError(400, "朗读文本需为 1–1200 个字符");
    const config = readConfiguration();
    if (!config.apiKey) throw new HttpError(503, "请先在设置中配置豆包语音 API Key");
    const controller = new AbortController(), queue = new PCMQueue();
    this.active.add(controller);
    let released = false, claimed = false;
    const release = () => {
      if (released) return;
      released = true; clearTimeout(timer);
      controller.signal.removeEventListener("abort", aborted);
      signal?.removeEventListener("abort", cancel); this.active.delete(controller);
    };
    const aborted = () => { queue.fail(new HttpError(499, "语音请求已取消")); release(); };
    const cancel = () => { if (!released) controller.abort(); };
    const timer = setTimeout(() => {
      queue.fail(new HttpError(504, "语音播放连接超时，请重试")); controller.abort();
    }, 65000);
    timer.unref();
    controller.signal.addEventListener("abort", aborted, { once: true });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    void this.adapter.performPCM(config, text.trim(), controller.signal, queue).then(() => {
      if (controller.signal.aborted) return;
      markCapability(config, "tts", true); queue.end();
    }).catch(error => {
      if (error instanceof HttpError && /鉴权|参数/.test(error.message)) {
        try { markCapability(config, "tts", false); } catch { /* The playback error takes precedence. */ }
      }
      queue.fail(error instanceof HttpError ? error : new HttpError(502, "语音服务暂不可用，请稍后重试"));
      release();
    });
    await queue.ready; queue.throwIfFailed();
    return { format: "pcm_s16le", sampleRate: 24000, channels: 1, cancel, chunks: {
      [Symbol.asyncIterator]() {
        if (claimed) throw new Error("语音流只能消费一次");
        claimed = true;
        let closed = false, reading = false;
        return {
          async next() {
            if (closed) return { done: true as const, value: undefined };
            if (reading) throw new Error("语音流不能并行读取");
            reading = true;
            try { const result = await queue.next(); if (result.done) { closed = true; release(); } return result; }
            finally { reading = false; }
          },
          async return() { closed = true; cancel(); return { done: true as const, value: undefined }; },
          async throw(error?: unknown) { closed = true; cancel(); throw error; },
        };
      },
    } };
  }
  async transcribe(wav: Buffer, signal?: AbortSignal): Promise<VoiceTranscription> {
    const pcm = parseVoiceWav(wav);
    return { text: await this.perform("asr", { pcm }, signal) as string };
  }
  private async perform(kind: "tts" | "asr", input: { text: string } | { pcm: Buffer }, signal?: AbortSignal) {
    const config = readConfiguration();
    if (!config.apiKey) throw new HttpError(503, "请先在设置中配置豆包语音 API Key");
    const controller = new AbortController(); this.active.add(controller);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) controller.abort();
    try { const result = await this.adapter.perform(config, input, controller.signal); markCapability(config, kind, true); return result; }
    catch (error) {
      if (error instanceof HttpError && /鉴权|参数/.test(error.message)) markCapability(config, kind, false);
      // Only our fixed messages escape; arbitrary errors could contain an upstream credential.
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "语音服务暂不可用，请稍后重试");
    } finally { signal?.removeEventListener("abort", cancel); this.active.delete(controller); }
  }
  close() { for (const controller of this.active) controller.abort(); }
}

/** Server-only adapter configuration. Never return this value from an HTTP handler. */
export function readVoiceStreamConfiguration(): { apiKey: string; voice: string } {
  const { apiKey, voice } = readConfiguration(); return { apiKey, voice };
}
