import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { DoubaoVoiceAdapter, VoiceService, parseVoiceWav, voiceWav, saveVoiceConfiguration, voiceConfigurationState, voiceConfigurationPath } from "./voice.ts";
import { OrbitStore, HttpError } from "./store.ts";
import { OrbitRuntime } from "./runtime.ts";
import { createOrbitServer } from "./http.ts";

async function configuration() {
  const dir = await mkdtemp(join(tmpdir(), "orbit-voice-")), previous = process.env.ORBIT_VOICE_CONFIG_PATH;
  process.env.ORBIT_VOICE_CONFIG_PATH = join(dir, "voice-config.json");
  return {dir, async close() { if (previous === undefined) delete process.env.ORBIT_VOICE_CONFIG_PATH; else process.env.ORBIT_VOICE_CONFIG_PATH = previous; await rm(dir,{recursive:true,force:true}); }};
}
async function mock(mode: "tts" | "tts-no-close" | "asr" | "error" | "hang") {
  const server = new WebSocketServer({host:"127.0.0.1",port:0}); await once(server,"listening");
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const received: Array<{event:Record<string,any>;at:number}> = [];
  server.on("connection", socket => {
    const send=(event:Record<string,unknown>)=>socket.send(JSON.stringify(event));
    socket.on("message",data=>{
      const event=JSON.parse(data.toString());received.push({event,at:performance.now()});
      if(event.type==="session.close") {if(mode!=="tts-no-close")send({type:"session.closed"});return;}
      if(mode==="hang") return;
      if(event.type==="session.create") {
        if(mode==="error") send({type:"error",error:{message:"401 invalid key TEST_SECRET_NEVER_RETURN"}});
        else send({type:"session.created",session:{id:"provider-session"}});
      }
      if(event.type==="speech_text_buffer.commit") {
        send({type:"response.output_audio.delta",delta:Buffer.from([1,0,2,0]).toString("base64")});
        send({type:"response.output_audio.delta",delta:Buffer.from([3,0,4,0]).toString("base64")});
        send({type:"response.output_audio.done"});
      }
      if(event.type==="input_audio_buffer.append"&&mode==="asr"&&received.filter(x=>x.event.type==="input_audio_buffer.append").length===1) {
        send({type:"conversation.item.input_audio_transcription.started",item_id:"spoken"});
        send({type:"conversation.item.input_audio_transcription.delta",item_id:"spoken",text:"识别中"});
      }
      if(event.type==="input_audio_buffer.commit") {
        // Real providers may omit an ACK; only completed is the transcription boundary.
        send({type:"conversation.item.input_audio_transcription.completed",item_id:"spoken",transcript:"周末去杭州。"});
        send({type:"response.output_text.done",text:"THIS_IS_NOT_A_TRANSCRIPT"});
      }
    });
  });
  return {received,endpoint:`ws://127.0.0.1:${address.port}`,async close(){for(const client of server.clients)client.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
const config={apiKey:"TEST_SECRET_NEVER_RETURN",voice:"zh_female_xiaohe_jupiter_bigtts"};
async function untilClosedRequest(upstream: {received: Array<{event:Record<string,any>}>}) {
  for(let i=0;i<100&&!upstream.received.some(x=>x.event.type==="session.close");i++)await new Promise(resolve=>setTimeout(resolve,5));
}

test("voice configuration stays private, writes 0600, and never treats a new key as verified",async()=>{
  const h=await configuration();
  try {
    assert.equal(voiceConfigurationState().configured,false);
    const saved=saveVoiceConfiguration(config);
    assert.equal(saved.configured,true);assert.equal(saved.tts,true);assert.equal(saved.asr,true);assert.deepEqual(saved.verified,{tts:false,asr:false});
    assert.equal(JSON.stringify(saved).includes(config.apiKey),false);
    assert.equal((await stat(voiceConfigurationPath())).mode&0o777,0o600);
    assert.equal(JSON.parse(await readFile(voiceConfigurationPath(),"utf8")).apiKey,config.apiKey);
    assert.throws(()=>saveVoiceConfiguration({apiKey:"x\ny"}),/有效/);
    assert.throws(()=>saveVoiceConfiguration({voice:"../invalid"}),/无效/);
    assert.throws(()=>saveVoiceConfiguration({clear:true,apiKey:"valid"}),/同时/);
    saveVoiceConfiguration({clear:true});assert.equal(voiceConfigurationState().configured,false);assert.equal(voiceConfigurationState().tts,false);
  } finally {await h.close();}
});

test("WAV parser enforces duration, PCM16, mono, rate and real chunk boundaries",()=>{
  const wav=voiceWav(Buffer.alloc(3200),16000);assert.equal(parseVoiceWav(wav).length,3200);
  for(const [offset,value] of [[20,3],[22,2],[32,4],[34,8]]) {const invalid=Buffer.from(wav);invalid.writeUInt16LE(value,offset);assert.throws(()=>parseVoiceWav(invalid),/PCM16/);}
  assert.throws(()=>parseVoiceWav(voiceWav(Buffer.alloc(100),24000)),/PCM16/);
  assert.throws(()=>parseVoiceWav(wav.subarray(0,-1)),/PCM16/);
  assert.throws(()=>parseVoiceWav(voiceWav(Buffer.alloc(32000*60+2),16000)),/60 秒/);
  assert.throws(()=>parseVoiceWav(Buffer.alloc(2*1024*1024+1)),/2 MB/);
  const junk=Buffer.concat([wav.subarray(0,12),Buffer.from([74,85,78,75,2,0,0,0,0,0]),wav.subarray(12)]);junk.writeUInt32LE(junk.length-8,4);assert.equal(parseVoiceWav(junk).length,3200);
});

test("TTS uses the verified realtime protocol, returns a complete WAV, and records only this capability",async()=>{
  const h=await configuration(), upstream=await mock("tts");
  try {
    saveVoiceConfiguration(config);
    const voice=new VoiceService(new DoubaoVoiceAdapter({endpoint:upstream.endpoint}));
    const audio=await voice.synthesize("你好");assert.equal(audio.readUInt32LE(24),24000);assert.deepEqual([...audio.subarray(44)],[1,0,2,0,3,0,4,0]);
    assert.equal(upstream.received[0].event.session.model,"1.2.6.1");assert.deepEqual(upstream.received[0].event.session.tools,[]);
    assert.equal(upstream.received.find(x=>x.event.type==="speech_text_buffer.commit")?.event.text,"你好");
    await untilClosedRequest(upstream);assert.equal(upstream.received.at(-1)?.event.type,"session.close");
    assert.deepEqual(voiceConfigurationState().verified,{tts:true,asr:false});
    saveVoiceConfiguration({voice:"another_voice"});assert.deepEqual(voiceConfigurationState().verified,{tts:false,asr:false});
    await assert.rejects(()=>voice.synthesize("x".repeat(1201)),/1200/);
  } finally {await upstream.close();await h.close();}
});

test("ASR paces audio, accepts completion without a commit ACK, and ignores generated replies",async()=>{
  const h=await configuration(),upstream=await mock("asr");
  try {
    saveVoiceConfiguration(config);
    const voice=new VoiceService(new DoubaoVoiceAdapter({endpoint:upstream.endpoint}));
    assert.deepEqual(await voice.transcribe(voiceWav(Buffer.alloc(1920),16000)),{text:"周末去杭州。"});
    const chunks=upstream.received.filter(x=>x.event.type==="input_audio_buffer.append");assert.equal(chunks.length,3);assert.ok(chunks[2].at-chunks[0].at>=30);
    assert.ok(chunks.every(x=>Buffer.from(x.event.audio,"base64").length===640));
    await untilClosedRequest(upstream);assert.deepEqual(upstream.received.slice(-2).map(x=>x.event.type),["response.cancel","session.close"]);
    assert.deepEqual(voiceConfigurationState().verified,{tts:false,asr:true});
  }finally {await upstream.close();await h.close();}
});

test("credential errors are fixed safe messages, and cancelling or timing out closes upstream",async()=>{
  const h=await configuration(),upstream=await mock("error"),hang=await mock("hang");
  try {
    saveVoiceConfiguration(config);
    const voice=new VoiceService(new DoubaoVoiceAdapter({endpoint:upstream.endpoint}));
    await assert.rejects(()=>voice.synthesize("你好"),error=>error instanceof Error&&/鉴权/.test(error.message)&&!error.message.includes(config.apiKey));
    assert.equal(voiceConfigurationState().tts,false);saveVoiceConfiguration({apiKey:config.apiKey});assert.equal(voiceConfigurationState().tts,true);
    const controller=new AbortController();const pending=new DoubaoVoiceAdapter({endpoint:hang.endpoint}).perform(config,{text:"你好"},controller.signal);setTimeout(()=>controller.abort(),20);
    await assert.rejects(pending,/取消/);
    await assert.rejects(()=>new DoubaoVoiceAdapter({endpoint:hang.endpoint,timeoutMs:20}).perform(config,{text:"你好"},new AbortController().signal),/超时/);
    assert.throws(()=>new DoubaoVoiceAdapter({endpoint:"wss://arbitrary.example"}),/本机/);
  }finally {await upstream.close();await hang.close();await h.close();}
});

test("complete TTS returns without waiting for a provider close acknowledgement",async()=>{
  const upstream=await mock("tts-no-close");let timeout:ReturnType<typeof setTimeout>|undefined;
  try {
    const result=await Promise.race([
      new DoubaoVoiceAdapter({endpoint:upstream.endpoint}).perform(config,{text:"你好"},new AbortController().signal),
      new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error("completed audio blocked on provider cleanup")),400);}),
    ]);
    assert.ok(Buffer.isBuffer(result));assert.equal(result.subarray(0,4).toString(),"RIFF");
    await untilClosedRequest(upstream);assert.equal(upstream.received.at(-1)?.event.type,"session.close");
  }finally{clearTimeout(timeout);await upstream.close();}
});

test("completion of an old credential cannot verify replacement settings",async()=>{
  const h=await configuration();
  try {
    saveVoiceConfiguration(config);let finish!:(value:Buffer)=>void;
    const adapter=new DoubaoVoiceAdapter();adapter.perform=async()=>new Promise<Buffer>(resolve=>{finish=resolve;});
    const pending=new VoiceService(adapter).synthesize("你好");
    saveVoiceConfiguration({apiKey:"replacement-key"});finish(voiceWav(Buffer.alloc(4)));
    await pending;assert.deepEqual(voiceConfigurationState().verified,{tts:false,asr:false});
  } finally {await h.close();}
});

async function streamingMock() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let client: import("ws").WebSocket | undefined, connections = 0;
  let committed!: () => void;
  const ready = new Promise<void>(resolve => { committed = resolve; });
  const received: Array<{ event: Record<string, any> }> = [];
  server.on("connection", socket => {
    client = socket; connections++;
    socket.on("message", data => {
      const event = JSON.parse(data.toString()); received.push({ event });
      if (event.type === "session.create") socket.send(JSON.stringify({ type: "session.created" }));
      if (event.type === "speech_text_buffer.commit") committed();
      if (event.type === "session.close") socket.send(JSON.stringify({ type: "session.closed" }));
    });
  });
  return {
    endpoint: `ws://127.0.0.1:${address.port}`, ready, received, get connections() { return connections; },
    event(event: Record<string, unknown>) { client!.send(JSON.stringify(event)); },
    audio(bytes: Buffer) { this.event({ type: "response.output_audio.delta", delta: bytes.toString("base64") }); },
    done() { this.event({ type: "response.output_audio.done" }); },
    async close() { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

test("stream resolves on first PCM, preserves split samples and does not wait for all audio", async () => {
  const h = await configuration(), upstream = await streamingMock();
  const service = new VoiceService(new DoubaoVoiceAdapter({ endpoint: upstream.endpoint }));
  try {
    saveVoiceConfiguration(config); assert.equal(voiceConfigurationState().streamingTts, true);
    const pending = service.synthesizeStream("你好"); await upstream.ready;
    let resolved = false; void pending.then(() => { resolved = true; });
    upstream.audio(Buffer.from([1])); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(resolved, false);
    upstream.audio(Buffer.from([0, 2, 0]));
    const stream = await pending;
    assert.deepEqual([stream.format, stream.sampleRate, stream.channels], ["pcm_s16le", 24000, 1]);
    const iterator = stream.chunks[Symbol.asyncIterator]();
    assert.deepEqual([...(await iterator.next()).value!], [1, 0, 2, 0]);
    assert.equal(upstream.received.some(x => x.event.type === "session.close"), false);
    upstream.audio(Buffer.from([3, 0, 4, 0])); upstream.done();
    assert.deepEqual([...(await iterator.next()).value!], [3, 0, 4, 0]); assert.equal((await iterator.next()).done, true);
    stream.cancel(); stream.cancel(); await untilClosedRequest(upstream);
    assert.equal(upstream.connections, 1); assert.deepEqual(voiceConfigurationState().verified, { tts: true, asr: false });
  } finally { service.close(); await upstream.close(); await h.close(); }
});

test("stream initial errors stay safe; failures after first audio never restart or retain queued audio", async () => {
  const h = await configuration(), upstream = await streamingMock(), denied = await mock("error");
  const service = new VoiceService(new DoubaoVoiceAdapter({ endpoint: upstream.endpoint }));
  try {
    saveVoiceConfiguration(config);
    const bad = new VoiceService(new DoubaoVoiceAdapter({ endpoint: denied.endpoint }));
    await assert.rejects(() => bad.synthesizeStream("你好"), error => error instanceof Error && /鉴权/.test(error.message) && !error.message.includes(config.apiKey));
    saveVoiceConfiguration(config);
    const pending = service.synthesizeStream("你好"); await upstream.ready; upstream.audio(Buffer.from([1, 0]));
    const stream = await pending, iterator = stream.chunks[Symbol.asyncIterator]();
    assert.deepEqual([...(await iterator.next()).value!], [1, 0]);
    upstream.audio(Buffer.from([2, 0])); upstream.event({ type: "error", error: { message: "internal TEST_SECRET_NEVER_RETURN" } });
    await untilClosedRequest(upstream);
    await assert.rejects(() => iterator.next(), error => error instanceof Error && /暂不可用/.test(error.message) && !error.message.includes(config.apiKey));
    assert.equal(upstream.connections, 1);
    assert.equal(upstream.received.filter(x => x.event.type === "speech_text_buffer.commit").length, 1);
  } finally { service.close(); await upstream.close(); await denied.close(); await h.close(); }
});

test("stream cancellation, iterator return and service close terminate pending upstream work", async () => {
  const h = await configuration();
  try {
    saveVoiceConfiguration(config);
    for (const mode of ["abort", "return", "close"] as const) {
      const upstream = await streamingMock(), controller = new AbortController();
      const service = new VoiceService(new DoubaoVoiceAdapter({ endpoint: upstream.endpoint }));
      try {
        const pending = service.synthesizeStream("你好", controller.signal); await upstream.ready;
        upstream.audio(Buffer.from([1, 0])); const stream = await pending, iterator = stream.chunks[Symbol.asyncIterator]();
        if (mode === "abort") controller.abort();
        else if (mode === "return") await iterator.return!();
        else service.close();
        stream.cancel(); stream.cancel();
        if (mode !== "return") await assert.rejects(() => iterator.next(), /取消/);
        else assert.equal((await iterator.next()).done, true);
        await untilClosedRequest(upstream); assert.ok(upstream.received.some(x => x.event.type === "session.close"));
      } finally { service.close(); await upstream.close(); }
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => new VoiceService().synthesizeStream("你好", controller.signal), /取消/);
  } finally { await h.close(); }
});

test("stream bounds slow-consumer buffers and resumes upstream as PCM is consumed", async () => {
  const h = await configuration(), upstream = await streamingMock();
  let receivedChunks = 0;
  const service = new VoiceService(new DoubaoVoiceAdapter({ endpoint: upstream.endpoint, onEvent: type => { if (type === "response.output_audio.delta") receivedChunks++; } }));
  try {
    saveVoiceConfiguration(config);
    const pending = service.synthesizeStream("你好"); await upstream.ready;
    const block = Buffer.alloc(32768, 1); upstream.audio(block); const stream = await pending;
    upstream.audio(block); await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(receivedChunks, 2);
    upstream.audio(block); await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(receivedChunks, 2, "upstream should pause at high water");
    const iterator = stream.chunks[Symbol.asyncIterator](); assert.equal((await iterator.next()).value!.length, block.length);
    for (let i = 0; i < 30 && receivedChunks < 3; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(receivedChunks, 3, "consumption should resume the paused socket");
    assert.equal((await iterator.next()).value!.length, block.length); assert.equal((await iterator.next()).value!.length, block.length);
    upstream.done(); assert.equal((await iterator.next()).done, true);
  } finally { service.close(); await upstream.close(); await h.close(); }
});

test("stream rejects oversized single chunks, invalid PCM endings and hanging first audio", async () => {
  const h = await configuration();
  try {
    saveVoiceConfiguration(config);
    for (const invalid of [Buffer.alloc(256 * 1024 + 2), Buffer.from([1])]) {
      const upstream = await streamingMock(), service = new VoiceService(new DoubaoVoiceAdapter({ endpoint: upstream.endpoint }));
      try {
        const pending = service.synthesizeStream("你好"); await upstream.ready; upstream.audio(invalid); upstream.done();
        await assert.rejects(pending, /过慢|完整音频/);
      } finally { service.close(); await upstream.close(); }
    }
    const upstream = await mock("hang"), service = new VoiceService(new DoubaoVoiceAdapter({ endpoint: upstream.endpoint, timeoutMs: 30 }));
    try { await assert.rejects(() => service.synthesizeStream("你好"), /超时/); }
    finally { service.close(); await upstream.close(); }
  } finally { await h.close(); }
});

test("voice HTTP routes keep auth, format/size limits, safe settings, and abort on client disconnect",async()=>{
  const h=await configuration();const store=new OrbitStore(":memory:"),runtime=new OrbitRuntime(store,[],h.dir);runtime.initialize({seed:false});
  let calls=0,cancelled=false;
  const adapter=new DoubaoVoiceAdapter();
  adapter.perform=async(_config,input,signal)=>{
    calls++;
    if("text" in input&&input.text==="等待") return new Promise((_,reject)=>signal.addEventListener("abort",()=>{cancelled=true;reject(new HttpError(499,"已取消"));},{once:true}));
    return "text" in input?voiceWav(Buffer.alloc(8)):"录音内容";
  };
  const server=createOrbitServer(runtime,undefined,{authToken:"test-token",voiceService:new VoiceService(adapter)});server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address&&typeof address!=="string");const origin=`http://127.0.0.1:${address.port}`;
  const headers={"x-orbit-token":"test-token","content-type":"application/json"};
  try {
    assert.equal((await fetch(origin+"/api/voice/config")).status,401);
    const setting=await fetch(origin+"/api/voice/config",{method:"PUT",headers,body:JSON.stringify(config)});assert.equal(setting.status,200);assert.equal((await setting.text()).includes(config.apiKey),false);
    const tts=await fetch(origin+"/api/voice/synthesize",{method:"POST",headers,body:JSON.stringify({text:"你好"})});assert.equal(tts.status,200);assert.equal(tts.headers.get("content-type"),"audio/wav");assert.equal((await tts.arrayBuffer()).byteLength,52);
    const asr=await fetch(origin+"/api/voice/transcribe",{method:"POST",headers:{...headers,"content-type":"audio/wav"},body:new Uint8Array(voiceWav(Buffer.alloc(3200),16000))});assert.deepEqual(await asr.json(),{text:"录音内容"});
    assert.equal((await fetch(origin+"/api/voice/transcribe",{method:"POST",headers,body:"{}"})).status,415);
    assert.equal((await fetch(origin+"/api/voice/transcribe",{method:"POST",headers:{...headers,"content-type":"audio/wav"},body:Buffer.alloc(2*1024*1024+1)})).status,413);
    assert.equal(calls,2);
    const controller=new AbortController();const pending=fetch(origin+"/api/voice/synthesize",{method:"POST",headers,body:JSON.stringify({text:"等待"}),signal:controller.signal});
    while(calls<3)await new Promise(resolve=>setTimeout(resolve,5));controller.abort();await assert.rejects(pending);
    for(let i=0;i<30&&!cancelled;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(cancelled,true);
  }finally {await runtime.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();await h.close();}
});
