import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitStore } from './store.ts';
import { RecapService } from './recap.ts';
import { recapSource, recapNodes, validateRecap } from '../shared/recap.ts';
import { seedEverydayShowcase } from './showcases/everyday.ts';
import { seedLearningShowcase } from './showcases/learning.ts';
import { seedTurnSummaries } from './showcases/seed-turn-summaries.ts';
import { seedRecaps } from './showcases/seed-recaps.ts';
import { layoutDiscussion } from '../apps/memory/discussion-layout.ts';
const generator = async (input: string) => ({nodes:[{roundIds:JSON.parse(input).rounds.map((r:{id:string})=>r.id), title:'关键结论', summary:'从实际回答中整理的结论。'}]});
function setup() { const store=new OrbitStore(':memory:'); const c=store.createConversation('测试讨论'); for(let i=0;i<3;i++){store.addMessage(c.id,'user',`问题${i}`);store.addMessage(c.id,'assistant',`回答${i}`);}return {store,c}; }
test('distilled points cover exact contiguous rounds; fabricated, repeated, missing and out-of-order sources fail',()=>{
  const {store,c}=setup(),source=recapSource(c.id,store.list('messages'),store.list('conversations'));
  const make=(ids:string[])=>({nodes:[{roundIds:ids,title:'标题',summary:'结论'}]});
  const ids=source.rounds.map(r=>r.id);assert.equal(validateRecap(make(ids),source).nodes.length,1);
  for(const invalid of [ids.slice(0,2),[ids[0]!,ids[0]!,ids[2]!],[...ids].reverse(),['foreign',...ids.slice(1)]])assert.throws(()=>validateRecap(make(invalid),source));
  source.forks=[source.rounds[1]!.messages.at(-1)!.id];assert.throws(()=>validateRecap(make(ids),source),/分叉/);store.close();
});
test('cached recap becomes stale after new answers or branches; expansion retains original sources',async()=>{
  const {store,c}=setup();let calls=0;const service=new RecapService(store,()=>{},async i=>{calls++;return generator(i);});
  await service.refresh(c.id);await service.refresh(c.id);assert.equal(calls,1);
  const make=(expanded=new Set<string>())=>recapNodes(c,store.list('messages'),store.get('memories',c.id),store.list('conversations'),expanded);
  const node=make()[0]!;assert.equal(node.rounds.length,3);assert.equal(make(new Set([node.id])).length,3);
  store.createConversation('继承',{parentId:c.id,forkMessageId:node.rounds[0]!.answers[0]!.id});assert.equal(make().length,3);
  await service.close();store.close();
});
test('model completion cannot persist a recap for messages changed during generation',async()=>{
  const {store,c}=setup();let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);
  const service=new RecapService(store,()=>{},async i=>{entered();await new Promise<void>(r=>release=r);return generator(i);});
  const job=service.refresh(c.id);await started;store.addMessage(c.id,'user','新问题');store.addMessage(c.id,'assistant','新结论');release();await job;assert.equal(store.get('memories',c.id)?.recap,undefined);await service.close();store.close();
});
test('authored learning recap keeps source coverage, real fork points and non-overlapping layout',()=>{
  const store=new OrbitStore(':memory:');seedEverydayShowcase(store);seedLearningShowcase(store);seedTurnSummaries(store);assert.equal(seedRecaps(store),16);assert.equal(seedRecaps(store),0);
  const convs=store.list('conversations').filter(c=>c.project==='学习与研究'), messages=store.list('messages');
  const nodes=Object.fromEntries(convs.map(c=>[c.id,recapNodes(c,messages,store.get('memories',c.id),store.list('conversations'),new Set())]));
  const graph=layoutDiscussion(convs,nodes);assert.ok(graph.boxes.length<=13);assert.equal(graph.edges.filter(e=>e.branch).length,4);
  for(const c of convs){const source=recapSource(c.id,messages,store.list('conversations'));validateRecap(store.require('memories',c.id).recap,source);assert.deepEqual(nodes[c.id]!.flatMap(n=>n.rounds.map(r=>r.id)),source.rounds.map(r=>r.id));}
  assert.ok(graph.boxes.every(n=>n.takeaway && n.takeaway.length<=80));
  for(const [i,a] of graph.headers.entries())for(const b of graph.headers.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${a.id} overlaps ${b.id}`);
  for(const [i,a] of graph.boxes.entries())for(const b of graph.boxes.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  store.close();
});

test('concise showcase conclusions enrich matching recaps without replacing edited summaries',()=>{
  const store=new OrbitStore(':memory:');seedEverydayShowcase(store);seedLearningShowcase(store);seedTurnSummaries(store);seedRecaps(store);
  const before=store.require('memories','daily-semi');
  store.put('memories',{...before,recap:{...before.recap!,nodes:before.recap!.nodes.map((n,i)=>({...n,takeaway:undefined,summary:i===1?'用户改过的结论':n.summary}))}});
  seedRecaps(store);
  const nodes=store.require('memories','daily-semi').recap!.nodes;
  assert.ok(nodes[0]!.takeaway);assert.equal(nodes[1]!.summary,'用户改过的结论');assert.equal(nodes[1]!.takeaway,undefined);
  store.close();
});
