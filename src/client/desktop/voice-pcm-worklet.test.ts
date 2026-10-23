import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./voice-pcm-worklet.js',import.meta.url),'utf8');
function processor(rate:number){let C:any;const frames:ArrayBuffer[]=[],events:Array<{type:string;rms:number}>=[];const ctx={sampleRate:rate,AudioWorkletProcessor:class{port={postMessage:(frame:any)=>{if (frame.byteLength !== undefined) frames.push(frame);else events.push(frame);}}},registerProcessor:(_name:string,c:any)=>{C=c;}};vm.runInNewContext(source,ctx);return {value:new C(),frames,events};}
test('worklet emits exactly 20 ms PCM16 mono frames at 16 kHz independent of source rate',()=>{
 for(const rate of [16000,44100,48000]){const {value,frames}=processor(rate);for(let offset=0;offset<rate;offset+=128)value.process([[new Float32Array(Math.min(128,rate-offset)).fill(.5)]]);assert.equal(frames.length,50);assert.equal(frames[0].byteLength,640);assert.equal(new DataView(frames[0]).getInt16(0,true),16384);}
});
test('meter reports measured RMS at 20 Hz without changing PCM or generating level in silence',()=>{
 const {value,frames,events}=processor(16000);
 for(let n=0;n<50;n++)value.process([[new Float32Array(320).fill(.1)]]);
 const levels=events.filter(e=>e.type==='level');assert.equal(frames.length,50);assert.equal(levels.length,20);
 assert.ok(levels.every(e=>Math.abs(e.rms-.1)<.00001));
 const silent=processor(16000);for(let n=0;n<5;n++)silent.value.process([[new Float32Array(320)]]);
 assert.ok(silent.events.filter(e=>e.type==='level').every(e=>e.rms===0));
});
test('worklet downmixes channels, clamps malformed samples and never writes to its audio output',()=>{
 const {value,frames}=processor(16000);const output=new Float32Array(320);
 value.process([[new Float32Array(320).fill(3),new Float32Array(320).fill(-1)]],[[output]]);
 assert.equal(new DataView(frames[0]).getInt16(0,true),32767);assert.ok(output.every(x=>x===0));
 const next=processor(16000);next.value.process([[new Float32Array(320).fill(NaN)]]);assert.equal(new DataView(next.frames[0]).getInt16(0,true),0);
});
test('local pause gives feedback at 400 ms without ending the utterance or altering PCM',()=>{
 const {value,frames,events}=processor(16000);
 const feed=(count:number,level:number)=>{for(let n=0;n<count;n++)value.process([[new Float32Array(320).fill(level)]]);};
 feed(3,.1);feed(19,0);
 assert.equal(events.filter(e=>e.type==='speech_start').length,1);
 assert.equal(events.filter(e=>e.type==='speech_pause').length,0);
 feed(1,0);
 assert.equal(events.filter(e=>e.type==='speech_pause').length,1);
 assert.equal(events.filter(e=>e.type==='speech_end').length,0);
 feed(19,0);assert.equal(events.filter(e=>e.type==='speech_pause').length,1);
 feed(1,0);assert.equal(events.filter(e=>e.type==='speech_end').length,1);
 assert.equal(frames.length,43);
 assert.equal(events.some(e=>e.type==='final'||e.type==='commit'),false);
});
test('resuming inside the endpoint window emits resume once; a longer pause has a fresh local onset',()=>{
 const {value,events}=processor(16000);
 const feed=(count:number,level:number)=>{for(let n=0;n<count;n++)value.process([[new Float32Array(320).fill(level)]]);};
 const speech=()=>events.filter(e=>e.type!=='level').map(e=>e.type);
 feed(3,.1);feed(20,0);feed(2,.1);
 assert.deepEqual(speech(),['speech_start','speech_pause']);
 feed(1,.1);feed(5,.1);
 assert.deepEqual(speech(),['speech_start','speech_pause','speech_resume']);
 feed(40,0);feed(3,.1);
 assert.deepEqual(speech(),['speech_start','speech_pause','speech_resume','speech_pause','speech_end','speech_start']);
});
test('silence and sub-threshold bursts never announce a pending user utterance',()=>{
 const {value,events}=processor(16000);
 for(let n=0;n<80;n++)value.process([[new Float32Array(320).fill(n%10<2?.1:0)]]);
 assert.equal(events.some(e=>e.type!=='level'),false);
});
