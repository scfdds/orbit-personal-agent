import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitStore } from '../store.ts';
import { seedEverydayShowcase } from './everyday.ts';
import { seedRecaps } from './seed-recaps.ts';
import { seedAiNewsShowcase } from './ai-news.ts';
import { recapNodes, recapSource, validateRecap } from '../../shared/recap.ts';
import { layoutDiscussion } from '../../apps/memory/discussion-layout.ts';
import { TopicOverviewService } from '../topic-overview.ts';

function setup() { const store = new OrbitStore(':memory:'); seedEverydayShowcase(store); seedRecaps(store); return store; }

test('AI news upgrade preserves existing Q&A and adds a source-bound 23-round, four-conversation case', () => {
  const store = setup();
  try {
    const before = store.list('messages');
    const result = seedAiNewsShowcase(store);
    assert.equal(result.inserted, true); assert.deepEqual(result.ids, ['daily-ai-radar', 'daily-agent-products', 'ai-news-mcp-apps', 'ai-news-shared-state']);
    const all = store.list('conversations'), conversations = all.filter(c => result.ids.includes(c.id)), messages = store.list('messages');
    assert.equal(messages.filter(m => result.ids.includes(m.conversationId)).length, 46);
    assert.equal(result.ids.reduce((n, id) => n + store.require('memories', id).discussion!.turns.length, 0), 23);
    for (const m of before) assert.deepEqual(store.get('messages', m.id), m);
    const nodes = Object.fromEntries(conversations.map(c => [c.id, recapNodes(c, messages, store.get('memories', c.id), all, new Set())]));
    for (const c of conversations) {
      const source = recapSource(c.id, messages, all);
      validateRecap(store.require('memories', c.id).recap, source);
      assert.deepEqual(nodes[c.id]!.flatMap(n => n.rounds.map(r => r.id)), source.rounds.map(r => r.id));
      if (c.parentId) {
        const parent = store.require('conversations', c.parentId), own = messages.filter(m => m.conversationId === parent.id);
        const expected = [...new Set([...(parent.inheritedSources || []), ...own.slice(0, own.findIndex(m => m.id === c.forkMessageId) + 1).map(m => m.id)])];
        assert.deepEqual(c.inheritedSources, expected);
      }
    }
    assert.equal(store.require('conversations', 'ai-news-mcp-apps').forkMessageId, 'daily-ai-radar-a4');
    assert.equal(store.require('conversations', 'ai-news-shared-state').forkMessageId, 'daily-agent-products-a4');
    const graph = layoutDiscussion(conversations, nodes);
    assert.equal(graph.edges.filter(e => e.branch).length, 3);
    assert.ok(graph.boxes.length >= 8 && graph.boxes.length <= 12);
    for (const [i, a] of graph.headers.entries()) for (const b of graph.headers.slice(i + 1)) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    const section = store.list('sections').find(s => s.name === 'AI 动态')!;
    assert.equal(section.overview?.sourceKey, new TopicOverviewService(store, () => {}).source(section.id).sourceKey);
    assert.equal(store.list('triggers').length, 0); assert.equal(store.list('runs').length, 0);
    store.deleteConversation('ai-news-shared-state');
    assert.equal(seedAiNewsShowcase(store).inserted, false);
    assert.equal(store.get('conversations', 'ai-news-shared-state'), undefined);
  } finally { store.close(); }
});

test('real followups, edited recap points and user branches stay intact during sample enrichment', () => {
  for (const change of ['message', 'recap', 'branch'] as const) {
    const store = setup();
    try {
      if (change === 'message') store.addMessage('daily-ai-radar', 'user', '真实问题，不能覆盖');
      if (change === 'recap') {
        const m = store.require('memories', 'daily-agent-products');
        store.put('memories', { ...m, recap: { ...m.recap!, nodes: m.recap!.nodes.map(n => ({ ...n, takeaway: '我修改的结论' })) } });
      }
      if (change === 'branch') store.createConversation('我自己的分支', { parentId: 'daily-ai-radar', forkMessageId: 'daily-ai-radar-a1' });
      const originals = ['daily-ai-radar', 'daily-agent-products'].map(id => ({ c: store.get('conversations', id), m: store.get('memories', id), messages: store.list('messages').filter(m => m.conversationId === id) }));
      const result = seedAiNewsShowcase(store);
      assert.equal(result.ids[0], 'ai-news-radar');
      for (const before of originals) {
        assert.deepEqual(store.get('conversations', before.c!.id), before.c);
        assert.deepEqual(store.get('memories', before.c!.id), before.m);
        assert.deepEqual(store.list('messages').filter(m => m.conversationId === before.c!.id), before.messages);
      }
      for (const id of result.ids) validateRecap(store.require('memories', id).recap, recapSource(id, store.list('messages'), store.list('conversations')));
    } finally { store.close(); }
  }
});

test('conflicting sample message IDs roll back the entire upgrade', () => {
  const store = setup();
  try {
    store.put('messages', { id: 'ai-news-shared-state-u1', conversationId: 'daily-git', role: 'user', content: '保留', createdAt: '2026-09-24T04:00:00.000Z' });
    const messages = store.list('messages'), conversations = store.list('conversations'), memories = store.list('memories');
    assert.throws(() => seedAiNewsShowcase(store), /冲突/);
    assert.deepEqual(store.list('messages'), messages); assert.deepEqual(store.list('conversations'), conversations); assert.deepEqual(store.list('memories'), memories);
    assert.equal(store.metadata('showcase:ai-news:v1'), undefined);
  } finally { store.close(); }
});
