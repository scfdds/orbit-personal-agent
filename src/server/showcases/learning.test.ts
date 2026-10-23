import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitStore } from '../store.ts';
import { seedEverydayShowcase } from './everyday.ts';
import { upgradeReaderSummaries } from './reader-summaries.ts';
import { seedLearningShowcase } from './learning.ts';

test('learning case extends the untouched introduction, with branching snapshots limited to the selected turn',()=>{
  const store=new OrbitStore(':memory:');
  try{
    seedEverydayShowcase(store);upgradeReaderSummaries(store);
    const original=store.list('messages').filter(m=>m.conversationId==='daily-semi');
    const result=seedLearningShowcase(store);
    assert.equal(result.inserted,true);assert.equal(result.ids.length,4);
    assert.equal(store.list('messages').filter(m=>result.ids.includes(m.conversationId)).length,48);
    for(const m of original) assert.deepEqual(store.get('messages',m.id),m);
    assert.equal(store.require('conversations','learning-roofline-example').parentId,'learning-hbm-concepts');
    for(const id of result.ids){
      const c=store.require('conversations',id), memory=store.require('memories',id);
      assert.ok(memory.summary.length>150);
      assert.ok(store.get('messages',memory.coveredMessageId!));
      if(c.parentId){
        const fork=store.require('messages',c.forkMessageId!);
        assert.equal(fork.conversationId,c.parentId);
        assert.ok(c.inheritedSources?.includes(fork.id));
        for(const source of c.inheritedSources||[]) assert.ok(store.require('messages',source).createdAt<=fork.createdAt);
      }
    }
    assert.equal(store.list('triggers').length,0);
    store.updateConversation('daily-semi',{title:'我的标题'});
    store.deleteConversation('learning-packaging-chain');
    assert.equal(seedLearningShowcase(store).inserted,false);
    assert.equal(store.require('conversations','daily-semi').title,'我的标题');
    assert.equal(store.get('conversations','learning-packaging-chain'),undefined);
  }finally{store.close();}
});

test('learning import preserves real followups and edited summaries, falling back to an independent case',()=>{
  const store=new OrbitStore(':memory:');
  try{
    seedEverydayShowcase(store);
    store.addMessage('daily-semi','user','这是真实的新增问题，不能混进示例');
    const m=store.require('memories','daily-semi');
    store.put('memories',{...m,summary:'我自己写的摘要',summaryEdited:true});
    upgradeReaderSummaries(store);
    const before=store.list('messages').filter(m=>m.conversationId==='daily-semi');
    const result=seedLearningShowcase(store);
    assert.equal(result.ids[0],'learning-chip-chain');
    assert.equal(store.list('messages').filter(m=>result.ids.includes(m.conversationId)).length,48);
    assert.deepEqual(store.list('messages').filter(m=>m.conversationId==='daily-semi'),before);
    assert.equal(store.require('memories','daily-semi').summary,'我自己写的摘要');
  }finally{store.close();}
});

test('learning import rejects collisions atomically before extending the introduction',()=>{
  const store=new OrbitStore(':memory:');
  try{
    seedEverydayShowcase(store);
    store.put('messages',{id:'learning-hbm-concepts-u1',conversationId:'daily-semi',role:'user',content:'保留',createdAt:new Date().toISOString()});
    const before=store.list('messages');
    assert.throws(()=>seedLearningShowcase(store),/冲突/);
    assert.deepEqual(store.list('messages'),before);
    assert.equal(store.get('conversations','learning-chip-chain'),undefined);
  }finally{store.close();}
});
