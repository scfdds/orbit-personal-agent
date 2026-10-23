import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { HttpError } from "./store.ts";
import { readVoiceStreamConfiguration, voiceProviderError } from "./voice.ts";

const ENDPOINT = "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue";
interface Options { endpoint?: string; ticketMs?: number; connectMs?: number; idleMs?: number; sessionMs?: number; maxSessions?: number }
type Event = Record<string, any>;

/** Browser tickets are one-use capabilities, never provider credentials. HTTP must authenticate issuance. */
export class VoiceStreamService {
  private tickets = new Map<string, { expiresAt: number; origin: string }>();
  private active = new Set<() => void>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  private closed = false;
  private endpoint: string;
  private options: Options;
  constructor(options: Options = {}) {
    this.options = options; this.endpoint = options.endpoint ?? ENDPOINT;
    if (this.endpoint !== ENDPOINT && !/^ws:\/\/(127\.0\.0\.1|localhost):\d+(?:\/|$)/.test(this.endpoint)) throw new Error("语音测试接口仅允许本机地址");
  }
  issueTicket(origin: string) {
    if (this.closed) throw new HttpError(503, "语音服务已关闭");
    if (!/^https?:\/\/[^/]+$/.test(origin)) throw new HttpError(400, "语音来源无效");
    if (!readVoiceStreamConfiguration().apiKey) throw new HttpError(503, "请先在设置中配置豆包语音 API Key");
    for (const [key, ticket] of this.tickets) if (ticket.expiresAt <= Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 12 || this.active.size >= (this.options.maxSessions ?? 2)) throw new HttpError(429, "语音连接已占用，请先关闭其他窗口的语音");
    const ticket = randomBytes(32).toString("base64url"), expiresAt = Date.now() + (this.options.ticketMs ?? 30000);
    this.tickets.set(ticket, { expiresAt, origin });
    return { ticket, expiresAt, path: "/api/voice/stream" };
  }
  /** Caller checks its own trusted host/path/origin first. This also binds and consumes the ticket atomically. */
  acceptUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(request.url ?? "/", "http://localhost"), value = url.searchParams.get("ticket") ?? "";
    const ticket = this.tickets.get(value); this.tickets.delete(value);
    if (this.closed || url.pathname !== "/api/voice/stream" || !ticket || ticket.expiresAt <= Date.now() || request.headers.origin !== ticket.origin || this.active.size >= (this.options.maxSessions ?? 2)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    this.wss.handleUpgrade(request, socket, head, ws => this.connect(ws));
  }
  private connect(client: WebSocket) {
    let upstream: WebSocket;
    try {
      const config = readVoiceStreamConfiguration();
      if (!config.apiKey) throw new Error();
      upstream = new WebSocket(this.endpoint, { headers: { "X-Api-Key": config.apiKey }, handshakeTimeout: this.options.connectMs ?? 15000, maxPayload: 1024 * 1024, perMessageDeflate: false, followRedirects: false });
      upstream.on("open", () => sendUpstream({ type: "session.create", session: {
        model: "1.2.6.1", instructions: "你只负责逐字转写用户语音，不回答问题，不执行任务。", tools: [],
        audio: { input: { format: { type: "pcm", rate: 16000 } }, output: { format: { type: "pcm_s16le", rate: 24000 }, voice: config.voice } },
      } }));
    } catch { client.close(1011, "语音配置不可用"); return; }
    let closed = false, ready = false, item = "", speechStarted = false;
    let lastAudio = Date.now(), lastActivity = Date.now(), budgetAt = Date.now(), budget = 16000, lastVoicedAudio = 0;
    let voicedSequence = 0, terminalVoicedSequence = 0;
    const completed = new Set<string>();
    const send = (event: Event) => {
      if (closed || client.readyState !== WebSocket.OPEN) return;
      if (client.bufferedAmount > 128 * 1024) { finish(); return; }
      client.send(JSON.stringify(event));
    };
    const sendUpstream = (event: Event) => {
      if (closed || upstream.readyState !== WebSocket.OPEN) return;
      if (upstream.bufferedAmount > 128 * 1024) { fail("语音网络较慢，请重新连接"); return; }
      upstream.send(JSON.stringify({ event_id: randomUUID(), ...event }));
    };
    const finish = () => {
      if (closed) return;
      closed = true;
      // Guard first: backpressure cleanup must not recurse through sendUpstream.
      if (upstream.readyState === WebSocket.OPEN && upstream.bufferedAmount < 128 * 1024) {
        upstream.send(JSON.stringify({ type: "response.cancel", event_id: randomUUID() }));
        upstream.send(JSON.stringify({ type: "session.close", event_id: randomUUID() }));
      }
       clearTimeout(connectTimer); clearTimeout(sessionTimer); clearInterval(healthTimer);
      this.active.delete(finish);
      if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
      else { upstream.close(); const timer = setTimeout(() => upstream.terminate(), 750); timer.unref(); upstream.once("close", () => clearTimeout(timer)); }
      if (client.readyState === WebSocket.OPEN) client.close(1000);
      const timer = setTimeout(() => client.terminate(), 750); timer.unref(); client.once("close", () => clearTimeout(timer));
    };
    const fail = (message: string) => { send({ type: "error", message }); finish(); };
    this.active.add(finish);
    const connectTimer = setTimeout(() => fail("语音连接超时，请重新开启"), this.options.connectMs ?? 15000);
    const sessionTimer = setTimeout(() => fail("本次语音已达到 10 分钟，请重新开启"), this.options.sessionMs ?? 600000);
    const healthTimer = setInterval(() => {
      if (ready && Date.now() - lastAudio > 15000) { fail("麦克风数据已中断，请重新开启"); return; }
      if (ready && Date.now() - lastActivity > (this.options.idleMs ?? 120000)) { fail("较长时间没有说话，语音已暂停。点击麦克风可继续"); return; }
      client.ping();
    }, 5000);
    healthTimer.unref(); sessionTimer.unref(); connectTimer.unref();
    client.on("message", (raw, binary) => {
      if (closed) return;
      if (!binary) {
        try { if (JSON.parse(raw.toString()).type === "close") { finish(); return; } } catch {}
        fail("语音输入格式无效"); return;
      }
      const pcm = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (!ready || pcm.length === 0 || pcm.length % 2 || pcm.length > 3200) { fail("语音输入需要实时 PCM16 数据"); return; }
      const now = Date.now(); budget = Math.min(16000, budget + (now - budgetAt) * 32); budgetAt = now;
      if (pcm.length > budget) { fail("语音输入速度异常，请重新开启"); return; }
      budget -= pcm.length; lastAudio = now;
      let energy = 0; for (let i = 0; i < pcm.length; i += 2) energy += (pcm.readInt16LE(i) / 32768) ** 2;
      if (Math.sqrt(energy / (pcm.length / 2)) >= 0.008) { lastVoicedAudio = now; voicedSequence++; }
      sendUpstream({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
    });
    upstream.on("message", (raw, binary) => {
      if (closed) return;
      let event: Event;
      try { if (binary) throw new Error(); event = JSON.parse(raw.toString()); if (!event || typeof event.type !== "string") throw new Error(); }
      catch { fail("语音服务返回无效数据，请重试"); return; }
      if (event.type === "error") { fail(voiceProviderError(JSON.stringify(event)).message); return; }
      if (event.type === "session.created" && !ready) {
        ready = true; clearTimeout(connectTimer); lastAudio = lastActivity = Date.now();
        sendUpstream({ type: "input_audio_unmute.commit" }); send({ type: "ready", sampleRate: 16000, format: "pcm_s16le" }); return;
      }
      if (!ready) return;
      // This event also announces a fresh recognition cycle after response.cancel, even in silence.
      // The local worklet and actual transcription text are the primary evidence of user speech.
      if (event.type === "conversation.item.input_audio_transcription.started") return;
      if (event.type === "input_audio_buffer.speech_started") {
        const nextItem = typeof event.item_id === "string" ? event.item_id : item || randomUUID();
        if (completed.has(nextItem)) return;
        // No fixed cooldown: an immediate next utterance is accepted after fresh voiced PCM arrives.
        if (Date.now() - lastVoicedAudio > 700 || voicedSequence <= terminalVoicedSequence) return;
        if (nextItem !== item || !speechStarted) {
          item = nextItem; speechStarted = true; lastActivity = Date.now(); send({ type: "speech_started", utteranceId: item });
        }
        sendUpstream({ type: "response.cancel" }); return;
      }
      if (["conversation.item.input_audio_transcription.delta", "conversation.item.input_audio_transcription.completed"].includes(event.type)) {
        const id = typeof event.item_id === "string" ? event.item_id : item || randomUUID();
        if (completed.has(id)) return;
        item = id; lastActivity = Date.now();
        const text = event.transcript ?? event.text ?? event.delta;
        if (typeof text !== "string" || text.length > 8000) {
          if (event.type.endsWith(".completed")) { completed.add(id); terminalVoicedSequence = voicedSequence; speechStarted = false; item = ""; send({ type: "no_speech", utteranceId: id }); }
          return;
        }
        if (event.type.endsWith(".completed")) {
          completed.add(id); if (completed.size > 300) completed.delete(completed.values().next().value!);
          terminalVoicedSequence = voicedSequence; speechStarted = false; item = ""; sendUpstream({ type: "response.cancel" });
          if (text.trim() && /[\p{L}\p{N}]/u.test(text)) send({ type: "final", utteranceId: id, text: text.trim() });
          else send({ type: "no_speech", utteranceId: id });
        } else {
          if (text.trim() && !speechStarted) { speechStarted = true; send({ type: "speech_started", utteranceId: id }); }
          send({ type: "partial", utteranceId: id, text: text.trim() });
        }
        return;
      }
      if (event.type === "conversation.item.input_audio_transcription.failed") { const id = typeof event.item_id === "string" ? event.item_id : item; if (completed.has(id)) return; if (id) completed.add(id); terminalVoicedSequence = voicedSequence; speechStarted = false; item = ""; send({ type: "no_speech", ...(id ? { utteranceId: id } : {}) }); return; }
      // The realtime provider may generate a reply even with ASR-only instructions. Cancel and discard it.
      if (["response.created", "response.output_audio.started", "response.output_text.delta", "response.function_call_arguments.done"].includes(event.type)) sendUpstream({ type: "response.cancel" });
    });
    upstream.on("error", error => { if (!closed) fail(voiceProviderError(error.message).message); });
    upstream.on("close", () => { if (!closed) fail("语音连接已断开，请重新开启"); });
    client.on("error", finish); client.on("close", finish);
  }
  close() { this.closed = true; this.tickets.clear(); for (const stop of this.active) stop(); this.wss.close(); }
}
