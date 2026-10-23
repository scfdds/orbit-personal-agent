import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitStore } from './store.ts';
import { SectionService } from './sections.ts';
import { TopicOverviewService } from './topic-overview.ts';
import { removeEmptyPlaceholders } from './empty-conversations.ts';
import { loadApps } from '../apps/registry.ts';

test('cleanup removes only empty legacy placeholders, protecting real work and app edits', async () => {
  const store = new OrbitStore(':memory:'), apps = await loadApps();
  const blank = store.createConversation();
  for (const app of apps) for (const seed of app.seed()) store.saveObject(blank.id, seed);
  const spoken = store.createConversation(); store.addMessage(spoken.id, 'user', '这段内容要保留');
  const goal = store.createConversation(); store.createWork(goal.id, '目标', '长期目标');
  const parent = store.createConversation(), branch = store.createConversation('分支', { parentId: parent.id, inheritedContext: '继承内容' });
  const edited = store.createConversation(), seed = apps.flatMap(a => a.seed())[0]!;
  const object = store.saveObject(edited.id, seed); store.saveObject(edited.id, { ...seed, id: object.id, expectedVersion: object.version, title: '用户编辑' });
  const appSession = store.createConversation('合同审阅');
  assert.deepEqual(removeEmptyPlaceholders(store, apps), [blank.id]);
  for (const c of [spoken, goal, parent, branch, edited, appSession]) assert.ok(store.get('conversations', c.id));
  assert.equal(store.list('objects').some(o => o.conversationId === blank.id), false);
  assert.deepEqual(removeEmptyPlaceholders(store, apps), []); store.close();
});

test('topic overview uses only answered Q&A in the topic, caches and refreshes on changed answers', async () => {
  const store = new OrbitStore(':memory:'), section = new SectionService(store).ensure('学习');
  const c = store.createConversation('带宽', { project: section.name });
  store.addMessage(c.id, 'user', '带宽是什么？'); store.addMessage(c.id, 'assistant', '每秒可传输的数据量。');
  store.addMessage(c.id, 'user', '还没有回答的问题');
  const other = store.createConversation('其他', { project: '其他' }); store.addMessage(other.id, 'assistant', '不应进入本话题');
  let calls = 0;
  const service = new TopicOverviewService(store, () => {}, async input => {
    calls++; assert.match(input, /每秒可传输/); assert.doesNotMatch(input, /还没有回答|不应进入/); return '带宽表示每秒可传输的数据量。';
  });
  await Promise.all([service.refresh(section.id), service.refresh(section.id)]); assert.equal(calls, 1);
  await service.refresh(section.id); assert.equal(calls, 1);
  const m = store.list('messages').find(m => m.role === 'assistant' && m.conversationId === c.id)!;
  store.put('messages', { ...m, content: '带宽是每秒可传输的数据量，与容量不同。' });
  await service.refresh(section.id); assert.equal(calls, 2);
  assert.match(store.require('sections', section.id).overview!.text, /带宽/);
  await service.close(); store.close();
});

test('in-flight changes cannot publish stale summaries; rename, failed refresh and empty topic are safe', async () => {
  const store = new OrbitStore(':memory:'), sections = new SectionService(store), section = sections.ensure('学习');
  const c = store.createConversation('讨论', { project: section.name }); store.addMessage(c.id, 'user', '问题'); store.addMessage(c.id, 'assistant', '旧回答');
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(r => started = r); let calls = 0;
  const service = new TopicOverviewService(store, () => {}, async input => {
    calls++; if (calls === 1) { started(); await new Promise<void>(r => release = r); return '过时总结'; }
    assert.match(input, /研究|新回答/); return '新总结';
  });
  const job = service.refresh(section.id); await entered;
  store.addMessage(c.id, 'user', '追问'); store.addMessage(c.id, 'assistant', '新回答'); sections.update(section.id, { name: '研究', pinned: true }); release(); await job;
  assert.equal(calls, 2); assert.equal(store.require('sections', section.id).overview!.text, '新总结'); assert.equal(store.require('sections', section.id).pinned, true);
  store.addMessage(c.id, 'assistant', '更多内容'); service.generate = async () => { throw new Error('offline'); };
  await assert.rejects(service.refresh(section.id)); assert.equal(store.require('sections', section.id).overview!.text, '新总结');
  store.deleteConversation(c.id); assert.equal(await service.refresh(section.id), ''); assert.equal(store.require('sections', section.id).overview, undefined);
  await service.close(); store.close();
});
