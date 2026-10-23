import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { PlaybackLevelMeter, rmsLevel, smoothLevel, visualLevel } from "./voice-levels.ts";

test("real RMS maps silence to zero and voice to a bounded, responsive envelope", () => {
  assert.equal(rmsLevel([0, 0, NaN]), 0);
  assert.equal(rmsLevel([.5, -.5, .5, -.5]), .5);
  assert.equal(visualLevel(0), 0); assert.equal(visualLevel(NaN), 0);
  assert.ok(visualLevel(.1) > visualLevel(.01)); assert.equal(visualLevel(3), 1);
  const attack = smoothLevel(0, 1), release = smoothLevel(1, 0);
  assert.ok(attack > .5 && attack < 1); assert.ok(release > .5 && release < 1);
  let value = 1; for (let i = 0; i < 40; i++) value = smoothLevel(value, 0);
  assert.equal(value, 0);
});

function graph({ delayed = false } = {}) {
  const connections: string[] = [], disconnected: string[] = []; let closed = 0, sourceCount = 0;
  const analyser = { fftSize: 512, connect: () => connections.push("analyser->destination"), disconnect: () => disconnected.push("analyser"), getFloatTimeDomainData: (samples: Float32Array) => samples.fill(.2) };
  const context = { state: delayed ? "suspended" : "running", destination: {}, resume: () => delayed ? new Promise<void>(() => {}) : Promise.resolve(), close: async () => { closed++; context.state = "closed"; }, createAnalyser: () => analyser,
    createMediaElementSource: () => { sourceCount++; return { connect: () => connections.push("source->analyser"), disconnect: () => disconnected.push("source") }; } };
  return { context: context as unknown as AudioContext, connections, disconnected, closed: () => closed, sourceCount: () => sourceCount };
}

test("meter uses a single existing playback route and disposal stops level callbacks", async () => {
  const g = graph(), levels: number[] = [];
  const meter = new PlaybackLevelMeter({} as HTMLAudioElement, level => levels.push(level), () => g.context);
  await meter.ready; meter.start(); meter.start(); await delay(115);
  assert.equal(g.sourceCount(), 1); assert.deepEqual(g.connections, ["analyser->destination", "source->analyser"]);
  assert.ok(levels.some(level => level > 0)); meter.dispose(); const count = levels.length;
  await delay(80); assert.equal(levels.length, count); assert.equal(levels.at(-1), 0);
  assert.deepEqual(g.disconnected, ["source", "analyser"]); assert.equal(g.closed(), 1);
  meter.dispose(); assert.equal(g.closed(), 1);
});

test("cancelling during AudioContext resume settles without binding or reviving playback", async () => {
  const g = graph({ delayed: true }), levels: number[] = [];
  const meter = new PlaybackLevelMeter({} as HTMLAudioElement, level => levels.push(level), () => g.context);
  meter.dispose(); await meter.ready; meter.start();
  assert.equal(g.sourceCount(), 0); assert.equal(g.closed(), 1); assert.deepEqual(levels, [0]);
});

test("unavailable Web Audio leaves the normal media element unbound and never invents a level", async () => {
  const levels: number[] = [];
  const meter = new PlaybackLevelMeter({} as HTMLAudioElement, level => levels.push(level), () => { throw new Error("not supported"); });
  await meter.ready; meter.start(); assert.deepEqual(levels, [0]);
});
