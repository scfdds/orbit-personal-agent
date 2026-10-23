import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrbitStore, HttpError } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";
import { VoiceService } from "./voice.ts";

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "orbit-pcm-http-"));
  const store = new OrbitStore(":memory:"), runtime = new OrbitRuntime(store, [], dir);
  runtime.initialize({ seed: false });
  const voice = new VoiceService();
  let calls = 0, cancelled = false, release: () => void = () => {};
  voice.synthesizeStream = async (text, signal) => {
    calls++;
    if (text === "early-error") throw new HttpError(502, "语音服务暂时不可用");
    const pending = new Promise<void>(resolve => { release = resolve; signal?.addEventListener("abort", () => { cancelled = true; resolve(); }, { once: true }); });
    return { format: "pcm_s16le", sampleRate: 24000, channels: 1, cancel() { cancelled = true; release(); }, chunks: (async function* () {
      yield Buffer.from([1, 0, 2, 0]);
      await pending;
      if (signal?.aborted) throw new HttpError(499, "取消");
      if (text === "mid-error") throw new HttpError(502, "连接中断");
      yield Buffer.from([3, 0, 4, 0]);
    })() };
  };
  const server = createOrbitServer(runtime, undefined, { authToken: "stream-test", voiceService: voice });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return {
    calls: () => calls, cancelled: () => cancelled, release: () => release(),
    post: (text: string, signal?: AbortSignal, authenticated = true) => fetch(`http://127.0.0.1:${address.port}/api/voice/synthesize-stream`, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { "x-orbit-token": "stream-test" } : {}) }, body: JSON.stringify({ text }), signal }),
    async close() { release(); await runtime.close(); voice.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

test("PCM HTTP authenticates and validates before synthesis, then sends first bytes before completion", async () => {
  const h = await harness();
  try {
    assert.equal((await h.post("你好", undefined, false)).status, 401);
    assert.equal((await h.post("长".repeat(121))).status, 400); assert.equal(h.calls(), 0);
    const response = await h.post("你好");
    assert.equal(response.headers.get("content-type"), "audio/pcm");
    assert.equal(response.headers.get("x-audio-sample-rate"), "24000");
    assert.equal(response.headers.get("x-audio-format"), "pcm_s16le");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const reader = response.body!.getReader();
    assert.deepEqual([...(await reader.read()).value!], [1, 0, 2, 0]);
    assert.equal(h.cancelled(), false); h.release();
    assert.deepEqual([...(await reader.read()).value!], [3, 0, 4, 0]);
    assert.equal((await reader.read()).done, true); assert.equal(h.cancelled(), true);
  } finally { await h.close(); }
});

test("a provider failure after PCM begins rejects the body, never reports a successful EOF", async () => {
  const h = await harness();
  try {
    const early = await h.post("early-error"); assert.equal(early.status, 502); assert.match(early.headers.get("content-type")!, /json/);
    const response = await h.post("mid-error"), reader = response.body!.getReader();
    assert.equal((await reader.read()).value?.length, 4); h.release();
    await assert.rejects(reader.read()); assert.equal(h.cancelled(), true);
  } finally { await h.close(); }
});

test("disconnecting during PCM playback cancels the synthesis producer", async () => {
  const h = await harness();
  try {
    const controller = new AbortController();
    const response = await h.post("等待", controller.signal), reader = response.body!.getReader();
    assert.equal((await reader.read()).value?.length, 4); controller.abort();
    await assert.rejects(reader.read());
    for (let i = 0; i < 50 && !h.cancelled(); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(h.cancelled(), true);
  } finally { await h.close(); }
});
