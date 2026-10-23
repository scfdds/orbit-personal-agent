import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { OrbitStore } from './store.ts';
import { DiscussionService } from './discussion.ts';
import { conversationRounds, discussionNodes } from '../shared/discussion.ts';
import { layoutDiscussion } from '../apps/memory/discussion-layout.ts';
import { OrbitRuntime } from './runtime.ts';
import { loadApps } from '../apps/registry.ts';
import { createOrbitServer } from './http.ts';
import { seedEverydayShowcase } from './showcases/everyday.ts';
import { seedLearningShowcase } from './showcases/learning.ts';
import { seedTurnSummaries } from './showcases/seed-turn-summaries.ts';
const generator=async(input:string)=>({turns:JSON.parse(input).rounds.map((r:{id:string})=>({id:r.id,question:'容量与带宽有什么区别？',answer:'容量是能装多少，带宽是每秒能搬多少。'}))});
test('cached LLM showcase turns match original sources and never replace existing turn edits',()=>{
  const store=new OrbitStore(':memory:');seedEverydayShowcase(store);seedLearningShowcase(store);assert.equal(seedTurnSummaries(store),31);assert.equal(seedTurnSummaries(store),0);
  const mem=store.require('memories','daily-semi');const turn=mem.discussion!.turns[0]!;store.put('memories',{...mem,discussion:{...mem.discussion!,turns:[{...turn,answer:'人工修正',edited:true}]}});
  seedTurnSummaries(store);assert.equal(store.require('memories','daily-semi').discussion!.turns[0]!.answer,'人工修正');store.close();
});
function setup(count=4){const store=new OrbitStore(':memory:');const c=store.createConversation('学习');for(let i=0;i<count;i++){store.addMessage(c.id,'user',`问题 ${i}`);store.addMessage(c.id,'assistant',`回答 ${i}`);}const service=new DiscussionService(store,()=>{},generator);return {store,c,service};}
test('rounds keep original order, exclude UI notices and combine steers before an answer',()=>{
  const {store,c}=setup(1);store.addMessage(c.id,'user','追问');store.addMessage(c.id,'user','补充条件');store.addMessage(c.id,'assistant','回答');
  const msg=store.addMessage(c.id,'assistant','链接');store.put('messages',{...msg,kind:'conversation_link'});
  const rounds=conversationRounds(c.id,store.list('messages'));assert.equal(rounds.length,2);assert.equal(rounds[1]!.questions.length,2);assert.equal(rounds[1]!.answers.length,1);assert.equal(rounds[1]!.messages.length,3);store.close();
});
test('generation validates every round, preserves prior summaries and persists across incremental batches',async()=>{
  const {store,c,service}=setup(12);let calls=0;
  service.generate=async input=>{calls++;return generator(input);};await service.schedule(c.id);assert.equal(calls,2);assert.equal(service.get(c.id).turns.length,12);assert.equal(service.get(c.id).status,'ready');
  store.addMessage(c.id,'user','新问题');store.addMessage(c.id,'assistant','新回答');service.generate=async()=>({turns:[{id:'foreign',question:'x',answer:'y'}]});await service.schedule(c.id);
  assert.equal(service.get(c.id).status,'failed');assert.equal(service.get(c.id).turns.length,12);
  service.generate=generator;await service.schedule(c.id);assert.equal(service.get(c.id).turns.length,13);await service.close();store.close();
});
test('delayed generation never overwrites manual round edits or an unrelated overview',async()=>{
  const {store,c,service}=setup(1);await service.schedule(c.id);const first=service.get(c.id).turns[0]!;
  store.addMessage(c.id,'user','再问');store.addMessage(c.id,'assistant','再答');
  let release!:()=>void,enter!:()=>void;const entered=new Promise<void>(r=>enter=r);
  service.generate=async input=>{enter();await new Promise<void>(r=>release=r);return generator(input);};const job=service.schedule(c.id);await entered;
  const version=service.get(c.id).version;service.edit(c.id,version,first.id,'人工标题','人工修正');assert.throws(()=>service.edit(c.id,version,first.id,'旧','旧'));
  store.put('memories',{...store.require('memories',c.id),summary:'独立的人工概述',summaryEdited:true});release();await job;
  assert.equal(service.get(c.id).turns.find(t=>t.id===first.id)?.answer,'人工修正');assert.equal(store.require('memories',c.id).summary,'独立的人工概述');await service.close();store.close();
});
test('only adjacent duplicate rounds aggregate; branch anchors and manual edits always stay separate',async()=>{
  const {store,c,service}=setup(4);await service.schedule(c.id);const d=service.get(c.id);d.turns=d.turns.map((t,i)=>i?{...t,merge:{question:'同一问题',answer:'合并回答'}}:t);store.put('memories',{...store.require('memories',c.id),discussion:d});
  const make=(expanded=new Set<string>())=>discussionNodes(c,store.list('messages'),store.get('memories',c.id),store.list('conversations'),expanded);
  let nodes=make();assert.deepEqual(nodes.map(n=>n.rounds.length),[2,2]);const expanded=make(new Set([nodes[0]!.id]));assert.deepEqual(expanded.map(n=>n.rounds.length),[1,1,2]);
  const reading=make(new Set([`round:${d.turns[1]!.id}`]));assert.deepEqual(reading.map(n=>n.rounds.length),[1,1,2]);
  const rounds=conversationRounds(c.id,store.list('messages'));store.createConversation('分支',{parentId:c.id,forkMessageId:rounds[1]!.answers[0]!.id});nodes=make();assert.deepEqual(nodes.map(n=>n.rounds.length),[1,1,2]);
  service.edit(c.id,d.version,d.turns[2]!.id,'人工问题','人工回答');nodes=make();assert.deepEqual(nodes.map(n=>n.rounds.length),[1,1,1,1]);await service.close();store.close();
});
test('graph branches from its actual source turn and main follow-ups remain sequential',()=>{
  const {store,c}=setup(4),rounds=conversationRounds(c.id,store.list('messages'));
  const child=store.createConversation('侧线',{parentId:c.id,forkMessageId:rounds[1]!.answers[0]!.id});store.addMessage(child.id,'user','分支问');store.addMessage(child.id,'assistant','分支答');
  const convs=store.list('conversations'),nodes=Object.fromEntries(convs.map(c=>[c.id,discussionNodes(c,store.list('messages'),undefined,convs,new Set())]));const graph=layoutDiscussion(convs,nodes);
  assert.equal(graph.boxes.length,5);assert.deepEqual(graph.edges.filter(e=>e.branch).map(e=>e.from),[rounds[1]!.id]);assert.equal(graph.edges.filter(e=>!e.branch).length,0);
  const main=graph.boxes.filter(n=>n.conversationId===c.id),branch=graph.boxes.find(n=>n.conversationId===child.id)!;
  assert.ok(main.every(n=>n.x===main[0]!.x));assert.ok(main.slice(1).every((n,i)=>n.y>main[i]!.y+main[i]!.height));
  assert.ok(branch.x>main[1]!.x+main[1]!.width);
  assert.ok(graph.headers.find(h=>h.id===child.id)!.y<=main[1]!.y);store.close();
});
test('conversation groups keep nested and sibling branches separate and inside the canvas',()=>{
  const store=new OrbitStore(':memory:');seedEverydayShowcase(store);seedLearningShowcase(store);seedTurnSummaries(store);
  const convs=store.list('conversations').filter(c=>c.project==='学习与研究');
  const nodes=Object.fromEntries(convs.map(c=>[c.id,discussionNodes(c,store.list('messages'),store.get('memories',c.id),convs,new Set())]));
  const graph=layoutDiscussion(convs,nodes);
  assert.equal(graph.boxes.length,27);assert.ok(graph.edges.filter(e=>e.branch).length>=4);
  for(const [i,a] of graph.boxes.entries()){
    assert.ok(a.x+a.width<=graph.width&&a.y+a.height<=graph.height);
    for(const b of graph.boxes.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${a.id} overlaps ${b.id}`);
  }
  store.close();
});
test('HTTP round generation/edit and selected-turn context stay within the exact original cutoff',async()=>{
  const {store,c}=setup(3);const runtime=new OrbitRuntime(store,await loadApps(),'/tmp/orbit-discussion-test');runtime.pump=()=>{};runtime.discussion.generate=generator;
  const server=createOrbitServer(runtime);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
  const req=(path:string,method:string,body={})=>fetch(`http://127.0.0.1:${address.port}/api${path}`,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    assert.equal((await req(`/conversations/${c.id}/discussion`,'POST')).status,202);await runtime.discussion.schedule(c.id);const d=runtime.discussion.get(c.id);assert.equal(d.turns.length,3);
    assert.equal((await req(`/conversations/${c.id}/discussion`,'PATCH',{version:d.version,turnId:d.turns[0]!.id,question:'修正问题',answer:'修正回答'})).status,200);
    assert.equal((await req(`/conversations/${c.id}/discussion`,'PATCH',{version:d.version,turnId:d.turns[0]!.id,question:'旧',answer:'旧'})).status,409);
    const round=conversationRounds(c.id,store.list('messages'))[0]!,target=store.createConversation('继续问');
    assert.equal((await req(`/conversations/${target.id}/messages`,'POST',{content:'解释这个回答',surface:{view:'memory',conversationId:c.id,messageId:round.answers[0]!.id}})).status,202);
    const surface=JSON.stringify(store.metadata(`surface:${target.id}`));assert.match(surface,/回答 0/);assert.doesNotMatch(surface,/回答 1|回答 2|conversationMemory/);
    const count=store.list('messages').length;assert.equal((await req(`/conversations/${target.id}/messages`,'POST',{content:'错误来源',surface:{view:'memory',conversationId:c.id,messageId:'fake'}})).status,404);assert.equal(store.list('messages').length,count);
  }finally{await runtime.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
