import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { PCM16Decoder, PCMStreamPlayer } from "./voice-pcm-player.ts";

test("PCM16 network decoding preserves signed samples across arbitrary odd and empty chunks", () => {
  const bytes = new Uint8Array([0, 128, 255, 127, 255, 255, 0, 0, 1, 0]);
  const decoder = new PCM16Decoder(), values: number[] = [];
  for (const chunk of [bytes.subarray(0, 1), new Uint8Array(), bytes.subarray(1, 4), bytes.subarray(4, 5), bytes.subarray(5)]) values.push(...decoder.decode(chunk));
  decoder.finish(); assert.deepEqual(values, [-1, 32767 / 32768, -1 / 32768, 0, 1 / 32768]);
  const truncated = new PCM16Decoder(); truncated.decode(new Uint8Array([1])); assert.throws(() => truncated.finish(), /不完整/);
});

function graph({ suspended = false } = {}) {
  type Source = { buffer?: { values: Float32Array }; at: number; stopped: number; disconnected: number; onended: (() => void) | null; connect(target: unknown): void; disconnect(): void; start(at: number): void; stop(): void };
  const sources: Source[] = [], connections: string[] = [];
  let closed = 0, analyserDisconnected = 0;
  const analyser = { fftSize: 512, connect: () => connections.push("analyser->destination"), disconnect: () => { analyserDisconnected++; }, getFloatTimeDomainData: (data: Float32Array) => data.fill(.2) };
  const context = {
    currentTime: 0, state: suspended ? "suspended" : "running", destination: {},
    resume: () => suspended ? new Promise<void>(() => {}) : Promise.resolve(),
    close: async () => { closed++; context.state = "closed"; }, createAnalyser: () => analyser,
    createBuffer: (_channels: number, length: number, rate: number) => { assert.equal(rate, 24000); const values = new Float32Array(length); return { values, getChannelData: () => values }; },
    createBufferSource: () => {
      const source: Source = { at: -1, stopped: 0, disconnected: 0, onended: null,
        connect: target => { assert.equal(target, analyser); connections.push("source->analyser"); },
        disconnect() { this.disconnected++; }, start(at) { this.at = at; }, stop() { this.stopped++; } };
      sources.push(source); return source;
    },
  };
  return { context, asContext: () => context as unknown as AudioContext, sources, connections, closed: () => closed, analyserDisconnected: () => analyserDisconnected };
}

test("PCM schedules before EOF, keeps buffered chunks sample-contiguous and detects audio-clock start", async () => {
  const g = graph(); let starts = 0;
  const player = new PCMStreamPlayer({ onStart: () => { starts++; }, onLevel() {} }, g.asContext);
  await player.ready;
  for (let i = 0; i < 10; i++) player.append(new Uint8Array(4800 * 2));
  assert.equal(g.sources.length, 10); assert.equal(g.sources[0].at, .06); assert.equal(player.started, false);
  for (let i = 1; i < g.sources.length; i++) assert.ok(Math.abs(g.sources[i].at - (g.sources[i - 1].at + .2)) < 1e-10);
  g.context.currentTime = .1;
  assert.equal(starts, 0, "renderer timer has not run yet"); assert.equal(player.started, true, "audio clock prevents replay after partial speech");
  player.dispose(); await player.finished; assert.equal(player.started, true);
  assert.equal(g.closed(), 1); assert.ok(g.sources.every(source => source.stopped === 1 && source.disconnected === 1));
});

test("tiny network chunks coalesce without creating one WebAudio source per sample", async () => {
  const g = graph(), player = new PCMStreamPlayer({ onStart() {}, onLevel() {} }, g.asContext);
  await player.ready;
  for (let i = 0; i < 482; i++) { player.append(new Uint8Array([1])); player.append(new Uint8Array([0])); }
  assert.equal(g.sources.length, 1); assert.equal(g.sources[0].buffer!.values.length, 480);
  assert.ok(g.sources[0].buffer!.values.every(sample => sample === 1 / 32768));
  player.end(); assert.equal(g.sources.length, 2); assert.equal(g.sources[1].buffer!.values.length, 2);
  assert.ok(Math.abs(g.sources[1].at - .08) < 1e-10);
  for (const source of g.sources) source.onended?.();
  await player.finished; assert.equal(g.closed(), 1); assert.equal(g.analyserDisconnected(), 1);
});

test("queued audio has a hard duration bound, with safe cleanup after overflow or partial samples", async () => {
  const g = graph(), player = new PCMStreamPlayer({ onStart() {}, onLevel() {} }, g.asContext);
  await player.ready; player.append(new Uint8Array(24000 * 2 * 30));
  assert.throws(() => player.append(new Uint8Array(24000 * 2 * 31)), /上限/);
  assert.equal(g.sources.length, 1); player.dispose(); await player.finished; assert.equal(g.closed(), 1);
  const second = graph(), partial = new PCMStreamPlayer({ onStart() {}, onLevel() {} }, second.asContext);
  await partial.ready; partial.append(new Uint8Array([1])); assert.throws(() => partial.end(), /不完整/);
  partial.dispose(); assert.equal(second.sources.length, 0); assert.equal(second.closed(), 1);
});

test("abort settles suspended startup, releases every graph once and cannot emit a late start", async () => {
  const g = graph({ suspended: true }); let starts = 0; const levels: number[] = [];
  const player = new PCMStreamPlayer({ onStart: () => { starts++; }, onLevel: value => levels.push(value) }, g.asContext);
  player.dispose(); player.dispose(); await player.ready; await player.finished;
  player.append(new Uint8Array(2400)); player.end(); await delay(90);
  assert.equal(starts, 0); assert.deepEqual(levels, [0]); assert.equal(g.sources.length, 0); assert.equal(g.closed(), 1);
});

test("stream meter reports measured samples then stops all callbacks after dispose", async () => {
  const g = graph(), levels: number[] = [];
  const player = new PCMStreamPlayer({ onStart() {}, onLevel: value => levels.push(value) }, g.asContext);
  await player.ready; player.append(new Uint8Array(24000)); await delay(180);
  assert.ok(levels.some(level => level > 0)); assert.deepEqual(g.connections, ["analyser->destination", "source->analyser"]);
  player.dispose(); const count = levels.length; await delay(130);
  assert.equal(levels.length, count); assert.equal(levels.at(-1), 0); assert.equal(g.closed(), 1);
});
