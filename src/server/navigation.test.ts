import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { OrbitStore } from './store.ts';
import { SectionService } from './sections.ts';
import { seedEverydayShowcase } from './showcases/everyday.ts';
import { OrbitRuntime } from './runtime.ts';
import { createOrbitServer } from './http.ts';
import { loadApps } from '../apps/registry.ts';

test('section pinning, ordering and cross-section moves preserve independent conversation ancestry', () => {
  const store=new OrbitStore(':memory:');
  try {
    const service=new SectionService(store);
    const parent=store.createConversation('main',{project:'Learning',pinned:true});
    const child=store.createConversation('branch',{project:'Learning',parentId:parent.id,forkMessageId:'source'});
    const casual=store.createConversation('casual',{project:'Daily'});
    const [learning,daily]=service.list();
    assert.equal(learning.name,'Learning');assert.equal(learning.pinned,true);
    service.update(learning.id,{name:'Research',pinned:false});
    assert.equal(store.require('conversations',child.id).project,'Research');
    assert.throws(()=>service.update(daily.id,{name:'Research'}));
    service.reorder(daily.id,learning.id);
    assert.equal(service.list()[0].id,daily.id);
    service.move(child.id,daily.id,casual.id);
    assert.equal(store.require('conversations',child.id).parentId,parent.id);
    assert.equal(store.require('conversations',child.id).order,0);
    assert.equal(store.require('conversations',casual.id).order,1);
    service.remove(daily.id);
    assert.equal(store.require('conversations',child.id).project,'未分区');
    assert.equal(store.list('conversations').length,3);
    store.deleteConversation(parent.id);
    assert.equal(store.require('conversations',child.id).parentId,undefined);
    assert.equal(store.require('conversations',child.id).title,'branch');
  } finally {store.close();}
});

test('daily examples import once, preserve real history and only inherit sources through their fork', () => {
  const store=new OrbitStore(':memory:');
  try {
    const real=store.createConversation('My actual discussion');
    store.put('messages',{id:'real-message',conversationId:real.id,role:'user',content:'Keep this exactly',createdAt:new Date().toISOString()});
    assert.equal(seedEverydayShowcase(store),true);
    assert.equal(store.require('conversations',real.id).project,'之前的对话');
    assert.equal(store.list('messages').find(m=>m.conversationId===real.id)?.content,'Keep this exactly');
    assert.equal(store.list('triggers').length,0);
    assert.equal(store.list('works').length,3);
    for(const memory of store.list('memories')) for(const item of memory.items) for(const id of item.sourceIds) assert.ok(store.get('messages',id));
    for(const c of store.list('conversations').filter(c=>c.parentId)) {
      const cutoff=store.require('messages',c.forkMessageId!).createdAt;
      for(const id of c.inheritedSources||[]) assert.ok(store.require('messages',id).createdAt<=cutoff);
    }
    store.updateConversation('daily-ai-radar',{title:'My edited title'});
    store.deleteConversation('daily-git');
    assert.equal(seedEverydayShowcase(store),false);
    assert.equal(store.require('conversations','daily-ai-radar').title,'My edited title');
    assert.equal(store.get('conversations','daily-git'),undefined);
  } finally {store.close();}
});

test('daily fixture refuses ID collisions before modifying history',()=>{
  const store=new OrbitStore(':memory:');
  try {
    store.createConversation('Keep me',{id:'daily-ai-radar',project:'My section'});
    assert.throws(()=>seedEverydayShowcase(store));
    assert.equal(store.require('conversations','daily-ai-radar').project,'My section');
    assert.equal(store.list('sections').length,0);
  } finally {store.close();}
});

test('HTTP page questions have an explicit new conversation and reading memory does not clear unread', async()=>{
  const store=new OrbitStore(':memory:');
  const runtime=new OrbitRuntime(store,await loadApps(),'/tmp/orbit-navigation-test');
  runtime.initialize();runtime.pump=()=>{};
  seedEverydayShowcase(store);
  const server=createOrbitServer(runtime);server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const request=(path:string,method='GET',body?:unknown)=>fetch(`http://127.0.0.1:${address.port}/api${path}`,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  try {
    const original='daily-agent-products';
    const beforeEmpty=store.list('conversations').length;
    assert.equal((await request('/conversations','POST',{})).status,400);
    assert.equal((await request('/intake','POST',{requestId:'empty-prompt',content:'   ',mode:'new'})).status,400);
    assert.equal(store.list('conversations').length,beforeEmpty);
    const count=store.list('messages').filter(m=>m.conversationId===original).length;
    assert.equal((await request(`/conversations/${original}/memory`)).status,200);
    assert.equal(store.require('conversations',original).unread,true);
    const created=await (await request('/conversations','POST',{title:'A page question'})).json() as {id:string};
    assert.equal((await request(`/conversations/${created.id}/messages`,'POST',{content:'根据这份记忆概括比较方法',surface:{view:'memory',conversationId:original}})).status,202);
    assert.equal(store.list('messages').filter(m=>m.conversationId===original).length,count);
    assert.match(runtime.contextSummary(created.id),/Agent 产品/);
    assert.equal(store.pending()[0].conversationId,created.id);
    const aiSection=runtime.sections.list().find(s=>s.name==='AI 动态')!;
    const topicChat=await (await request('/conversations','POST',{title:'A topic question'})).json() as {id:string};
    assert.equal((await request(`/conversations/${topicChat.id}/messages`,'POST',{content:'这个话题聊过哪些内容？',surface:{view:'memory',sectionId:aiSection.id}})).status,202);
    const surface=store.metadata(`surface:${topicChat.id}`) as {topic:{name:string;conversations:{id:string;summary:string;items?:unknown}[]}};
    assert.equal(surface.topic.name,'AI 动态');
    assert.equal(surface.topic.conversations.length,2);
    assert.ok(surface.topic.conversations.every(c=>store.require('conversations',c.id).project==='AI 动态' && c.summary && c.items===undefined));
    assert.equal(store.require('conversations',original).unread,true);
    const before=store.list('messages').length;
    assert.equal((await request(`/conversations/${topicChat.id}/messages`,'POST',{content:'Invalid reference',surface:{view:'memory',sectionId:'missing-topic'}})).status,404);
    assert.equal(store.list('messages').length,before);
    assert.equal((await request(`/conversations/${topicChat.id}`,'DELETE')).status,200);
    const section=await (await request('/sections','POST',{name:'Temporary section'})).json() as {id:string};
    assert.equal((await request(`/conversations/${created.id}/move`,'POST',{sectionId:section.id})).status,200);
    assert.equal((await request(`/sections/${section.id}`,'PATCH',{name:'Renamed',pinned:true})).status,200);
    assert.equal(store.require('conversations',created.id).project,'Renamed');
    assert.equal((await request(`/conversations/${created.id}`,'DELETE')).status,200);
    assert.equal(store.pending().length,0);
    assert.equal(store.metadata(`surface:${created.id}`),undefined);
    assert.equal((await request(`/sections/${section.id}`,'DELETE')).status,200);
    assert.ok(store.get('conversations',original));
  } finally {await runtime.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
