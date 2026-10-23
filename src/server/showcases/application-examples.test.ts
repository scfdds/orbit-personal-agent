import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitStore } from '../store.ts';
import { seedApplicationExamples } from './application-examples.ts';
import { demoCases, subagentExampleId } from '../../shared/demo-guide.ts';
import { applicationRecords } from './application-records.ts';

test('bundled examples retain actual outcomes and referential integrity without scheduling anything', () => {
  const store=new OrbitStore(':memory:');
  try {
    assert.equal(seedApplicationExamples(store),true);
    for(const item of demoCases) {
      assert.equal(store.require('conversations',item.conversationId).project,'应用示例');
      assert.ok(store.list('messages').some(m=>m.conversationId===item.conversationId&&m.role==='assistant'));
      assert.ok(store.list('objects').some(o=>o.conversationId===item.conversationId&&o.appId===item.id&&o.version>1));
    }
    for(const m of store.list('messages')) if(m.runId) assert.ok(store.get('runs',m.runId));
    for(const r of store.list('runs')) {assert.equal(r.status,'completed'); if(r.parentId)assert.ok(store.get('runs',r.parentId));}
    for(const e of store.list('subagentEvents')) {assert.ok(store.get('runs',e.runId));assert.ok(store.get('subagents',e.agentId));}
    assert.equal(store.list('subagents').filter(a=>a.conversationId===subagentExampleId).length,2);
    const contract=store.list('objects').find(o=>o.appId==='contracts')!;
    const suggestions=contract.data.suggestions as {status:string;editedByUser?:boolean}[];
    assert.ok(suggestions.some(s=>s.status==='rejected'));assert.ok(suggestions.some(s=>s.editedByUser));
    assert.equal(store.list('triggers').length,0);assert.equal(store.pending().length,0);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM metadata WHERE key LIKE 'session:%'").get()!.n,0);
    assert.equal(JSON.stringify(applicationRecords).includes('/Users/'),false);
  } finally {store.close();}
});

test('initialization preserves local edits and subsequent deletions',()=>{
 const store=new OrbitStore(':memory:');
 try {
  const original=structuredClone(applicationRecords.conversations[0]!);
  store.put('conversations',{...original,title:'用户改过的标题',project:'我的项目'});
  const object={...structuredClone(applicationRecords.objects[0]!),version:19,title:'用户合同'};
  store.put('objects',object);
  seedApplicationExamples(store);
  assert.equal(store.require('conversations',original.id).title,'用户改过的标题');
  assert.equal(store.require('conversations',original.id).project,'我的项目');
  assert.deepEqual(store.require('objects',object.id),object);
  assert.equal(store.list('messages').filter(m=>m.conversationId===original.id).length,0);
  store.deleteConversation(demoCases[1].conversationId);
  assert.equal(seedApplicationExamples(store),false);
  assert.equal(store.get('conversations',demoCases[1].conversationId),undefined);
 } finally {store.close();}
});


test('a record collision refuses the import atomically', () => {
 const store=new OrbitStore(':memory:');
 try {
  const message={...structuredClone(applicationRecords.messages[0]!),conversationId:'another-conversation',content:'Keep this record'};
  store.put('messages',message);
  assert.throws(()=>seedApplicationExamples(store),/未覆盖现有数据/);
  assert.deepEqual(store.list('messages'),[message]);
  assert.equal(store.list('conversations').length,0);
  assert.equal(store.list('sections').length,0);
  assert.equal(store.metadata('showcase:application-examples:v1'),undefined);
 } finally {store.close();}
});
