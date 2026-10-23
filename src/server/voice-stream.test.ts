import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { VoiceStreamService } from "./voice-stream.ts";
import { saveVoiceConfiguration } from "./voice.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(options: { ticketMs?: number; connectMs?: number; hang?: boolean; maxSessions?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "orbit-stream-test-")), previous = process.env.ORBIT_VOICE_CONFIG_PATH;
  process.env.ORBIT_VOICE_CONFIG_PATH = join(dir, "voice-config.json");
  saveVoiceConfiguration({ apiKey: "TEST_SECRET_NEVER_RETURN" });
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(upstream, "listening");
  const ua = upstream.address(); assert.ok(ua && typeof ua !== "string");
  const received: Record<string, any>[] = []; let provider: WebSocket | undefined;
  upstream.on("connection", socket => {
    provider = socket;
    socket.on("message", raw => {
      const event = JSON.parse(raw.toString()); received.push(event);
      if (event.type === "session.create" && !options.hang) socket.send(JSON.stringify({ type: "session.created" }));
      if (event.type === "session.close") socket.close();
    });
  });
  const service = new VoiceStreamService({ endpoint: `ws://127.0.0.1:${ua.port}`, ...options });
  const server = createServer(); server.on("upgrade", (req, socket, head) => service.acceptUpgrade(req, socket, head));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const addr = server.address(); assert.ok(addr && typeof addr !== "string");
  const origin = `http://127.0.0.1:${addr.port}`;
  const connect = (ticket = service.issueTicket(origin).ticket, source = origin) => {
    const client = new WebSocket(origin.replace("http", "ws") + "/api/voice/stream?ticket=" + ticket, { origin: source });
    const events: Record<string, any>[] = [];
    client.on("message", raw => events.push(JSON.parse(raw.toString())));
    return { client, events };
  };
  const until = async (condition: () => boolean) => { for (let i = 0; i < 100 && !condition(); i++) await sleep(5); assert.ok(condition()); };
  return { service, origin, connect, received, until, emit(event: object) { provider!.send(JSON.stringify(event)); },
    async close() { service.close(); for (const c of upstream.clients) c.terminate(); await new Promise<void>(resolve => upstream.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); if (previous === undefined) delete process.env.ORBIT_VOICE_CONFIG_PATH; else process.env.ORBIT_VOICE_CONFIG_PATH = previous; await rm(dir, { recursive: true, force: true }); } };
}

test("streaming forwards VAD, cumulative partials and deduplicated finals only; no provider answers", async () => {
  const f = await fixture();
  try {
    const { client, events } = f.connect(); await f.until(() => events.some(e => e.type === "ready"));
    client.send(Buffer.alloc(640, 20)); await f.until(() => f.received.some(e => e.type === "input_audio_buffer.append"));
    assert.equal(Buffer.from(f.received.find(e => e.type === "input_audio_buffer.append")!.audio, "base64").length, 640);
    f.emit({ type: "conversation.item.input_audio_transcription.started", item_id: "u1" });
    f.emit({ type: "conversation.item.input_audio_transcription.delta", item_id: "u1", text: "去杭州" });
    f.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", text: "周末去杭州。" });
    f.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", text: "重复" });
    f.emit({ type: "response.output_text.delta", delta: "NEVER_USE_FREE_ANSWER" });
    f.emit({ type: "response.output_audio.delta", delta: "AAAA" });
    f.emit({ type: "response.function_call_arguments.done", name: "EVIL_TOOL" });
    await f.until(() => events.some(e => e.type === "final")); await sleep(20);
    assert.deepEqual(events.map(e => e.type), ["ready", "speech_started", "partial", "final"]);
    assert.equal(events.at(-1)!.text, "周末去杭州。");
    assert.equal(JSON.stringify(events).includes("TEST_SECRET"), false);
    assert.ok(f.received.some(e => e.type === "response.cancel"));
    assert.deepEqual(f.received[0].session.tools, []);
    client.close(); await f.until(() => f.received.some(e => e.type === "session.close"));
  } finally { await f.close(); }
});

test("tickets are short-lived, single-use and origin bound", async () => {
  const f = await fixture({ ticketMs: 30 });
  const rejected = async (ticket: string, origin?: string) => { const { client } = f.connect(ticket, origin); const [error] = await once(client, "error"); assert.match(error.message, /403/); };
  try {
    const ticket = f.service.issueTicket(f.origin).ticket; await rejected(ticket, "https://evil.example"); await rejected(ticket);
    const expired = f.service.issueTicket(f.origin).ticket; await sleep(40); await rejected(expired);
    const next = f.service.issueTicket(f.origin).ticket, active = f.connect(next); await f.until(() => active.events.length > 0); await rejected(next); active.client.close();
  } finally { await f.close(); }
});

test("empty/failed utterances remain listening, following speech is accepted", async () => {
  const f = await fixture();
  try {
    const { events } = f.connect(); await f.until(() => events.length > 0);
    f.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "empty", text: "。。。" });
    f.emit({ type: "conversation.item.input_audio_transcription.failed" });
    f.emit({ type: "conversation.item.input_audio_transcription.started", item_id: "good" });
    f.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "good", text: "继续说话" });
    await f.until(() => events.some(e => e.type === "final"));
    assert.equal(events.filter(e => e.type === "no_speech").length, 2);
    assert.equal(events.filter(e => e.type === "final").length, 1);
  } finally { await f.close(); }
});

test("concurrency, malformed PCM and connection timeout close streams safely", async () => {
  const f = await fixture({ maxSessions: 1 });
  try {
    const { client, events } = f.connect(); await f.until(() => events.length > 0);
    assert.throws(() => f.service.issueTicket(f.origin), /连接已占用/);
    client.send(Buffer.alloc(3)); await f.until(() => events.some(e => e.type === "error"));
    assert.match(events.at(-1)!.message, /PCM16/);
    await f.until(() => f.received.some(e => e.type === "session.close"));
  } finally { await f.close(); }
  const hang = await fixture({ hang: true, connectMs: 30 });
  try { const { events } = hang.connect(); await hang.until(() => events.some(e => e.type === "error")); assert.match(events.at(-1)!.message, /超时/); }
  finally { await hang.close(); }
});

test("upstream credentials or arbitrary error prose never reach the browser", async () => {
  const f = await fixture();
  try {
    const { events } = f.connect(); await f.until(() => events.length > 0);
    f.emit({ type: "error", error: { message: "401 invalid key TEST_SECRET_NEVER_RETURN" } });
    await f.until(() => events.some(e => e.type === "error"));
    assert.match(events.at(-1)!.message, /鉴权/); assert.equal(JSON.stringify(events).includes("TEST_SECRET"), false);
  } finally { await f.close(); }
});

test("provider readiness-like started events in silence do not masquerade as user interruption", async () => {
  const f = await fixture();
  try {
    const { client, events } = f.connect(); await f.until(() => events.length > 0);
    client.send(Buffer.alloc(640)); f.emit({ type: "conversation.item.input_audio_transcription.started", item_id: "silent-cycle" });
    await sleep(20); assert.equal(events.some(e => e.type === "speech_started"), false);
    client.send(Buffer.alloc(640, 20)); await f.until(() => f.received.filter(e => e.type === "input_audio_buffer.append").length === 2);
    f.emit({ type: "input_audio_buffer.speech_started", item_id: "real-onset" });
    await f.until(() => events.some(e => e.type === "speech_started")); assert.equal(events.at(-1)!.utteranceId, "real-onset");
  } finally { await f.close(); }
});

test("completed speech cannot be interrupted by a late provider recognition cycle or stale voiced PCM", async () => {
  const f = await fixture();
  try {
    const { client, events } = f.connect(); await f.until(() => events.some(e => e.type === "ready"));
    client.send(Buffer.alloc(640, 20)); await f.until(() => f.received.some(e => e.type === "input_audio_buffer.append"));
    f.emit({ type: "input_audio_buffer.speech_started", item_id: "one" });
    f.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "one", text: "我们之前干了些啥" });
    await f.until(() => events.some(e => e.type === "final"));
    // Both arrive inside the old 700 ms energy window, but no new voice was received.
    f.emit({ type: "conversation.item.input_audio_transcription.started", item_id: "readiness-cycle" });
    f.emit({ type: "input_audio_buffer.speech_started", item_id: "stale-onset" });
    await sleep(20);
    assert.deepEqual(events.map(e => e.type), ["ready", "speech_started", "final"]);
    // A real immediate next utterance has no cooldown; fresh energy allows its VAD through.
    client.send(Buffer.alloc(640, 20)); await f.until(() => f.received.filter(e => e.type === "input_audio_buffer.append").length === 2);
    f.emit({ type: "input_audio_buffer.speech_started", item_id: "two" });
    f.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "two", text: "再说说杭州" });
    await f.until(() => events.filter(e => e.type === "final").length === 2);
    assert.deepEqual(events.filter(e => e.type === "speech_started").map(e => e.utteranceId), ["one", "two"]);
  } finally { await f.close(); }
});

test("actual partial text remains a speech fallback for quiet input without local energy onset", async () => {
  const f = await fixture();
  try {
    const { client, events } = f.connect(); await f.until(() => events.some(e => e.type === "ready"));
    client.send(Buffer.alloc(640));
    f.emit({ type: "conversation.item.input_audio_transcription.started", item_id: "quiet" });
    f.emit({ type: "conversation.item.input_audio_transcription.delta", item_id: "quiet", text: "我还有个问题" });
    f.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "quiet", text: "我还有个问题" });
    await f.until(() => events.some(e => e.type === "final"));
    assert.deepEqual(events.map(e => e.type), ["ready", "speech_started", "partial", "final"]);
    assert.equal(events.at(-1)!.text, "我还有个问题");
  } finally { await f.close(); }
});
