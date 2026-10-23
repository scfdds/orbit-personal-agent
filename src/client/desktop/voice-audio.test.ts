import test from "node:test";
import assert from "node:assert/strict";
import { pcm16Wav, spokenText, VoiceEpoch } from "./voice-audio.ts";

test("ASR payload is mono PCM16 WAV with bounded signed samples", () => {
  const buffer = pcm16Wav(new Float32Array([-2, -1, 0, 1, 2, NaN]));
  const view = new DataView(buffer);
  assert.equal(Buffer.from(buffer).subarray(0, 4).toString(), "RIFF");
  assert.equal(Buffer.from(buffer).subarray(8, 12).toString(), "WAVE");
  assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12); assert.equal(buffer.byteLength, 56);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, -32768, 0, 32767, 32767, 0]);
});

test("brief playback skips code, images, links and verbose Markdown", () => {
  assert.equal(spokenText("# 已整理\n可以从[计划](https://example.com)开始。下一步确认预算。第三句不用自动读。\n```js\nsecret()\n```", true), "已整理 可以从计划开始。下一步确认预算。");
  assert.equal(spokenText("![截图](https://example.com/image.png)\n```ts\ncode\n```"), "");
  assert.ok(spokenText("长".repeat(4000), true).length < 130);
  assert.ok(spokenText("长".repeat(4000)).length <= 500);
});

test("late voice work stays invalid after interruption and a replacement request", () => {
  const epoch = new VoiceEpoch();
  const old = epoch.next();
  assert.equal(epoch.current(old), true);
  epoch.next(); // User stopped playback or moved to another matter.
  const next = epoch.next();
  assert.equal(epoch.current(old), false);
  assert.equal(epoch.current(next), true);
});
