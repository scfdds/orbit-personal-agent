import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrbitStore } from './store.ts';
import { ProjectService } from './projects.ts';
import { WechatBetaService } from './wechat-beta.ts';
import { WechatPersonalService } from './wechat-personal.ts';
import { wechatDemoScenarios } from './wechat-demo.ts';

async function fixture(capture: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-wechat-demo-'));
  const store = new OrbitStore(':memory:');
  const beta = new WechatBetaService(store, dir, undefined, undefined, { platform: 'linux' });
  const projects = new ProjectService(store, () => {}, undefined, dir);
  let modelCalls = 0;
  const personal = new WechatPersonalService(store, beta, projects, undefined, async () => {
    modelCalls++;
    throw new Error('Demo must not invoke a model');
  });
  beta.context.import({ messages: [{ id: 'private-one', chatId: 'private-chat', chatTitle: 'PRIVATE_DEMO_SENTINEL', sender: '私人联系人', direction: 'incoming', text: 'PRIVATE_DEMO_SENTINEL', timestamp: '2026-10-21T10:00:00Z' }] }, 'notification');
  const chatId = beta.state().chats[0]!.id;
  beta.patchChat(chatId, { enabled: true });
  beta.capture(capture);
  const project = projects.create({ name: 'PRIVATE_DEMO_PROJECT' });
  projects.saveDocument(project.id, 0, '# PRIVATE_DEMO_MEMORY\n真实项目背景不应被演示改动。');
  personal.patch(chatId, { version: 0, projectId: project.id, background: 'PRIVATE_DEMO_CONTEXT', watching: true });
  return {
    store, beta, projects, personal, chatId, projectId: project.id,
    modelCalls: () => modelCalls,
    async close() {
      await personal.close(); await beta.close(); await projects.close(); store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('demo examples provide original notifications separately from project background', () => {
  const sourceIds = new Set<string>();
  assert.equal(wechatDemoScenarios.length, 3);
  for (const scenario of wechatDemoScenarios) {
    assert.ok(scenario.sources.length >= 2 && scenario.sources.length <= 3);
    let previousTime = 0;
    for (const source of scenario.sources) {
      assert.ok(!sourceIds.has(source.id), 'notification IDs must be unique across examples');
      sourceIds.add(source.id);
      assert.ok(source.sender && source.text);
      assert.match(source.timestamp, /^2026-10-22T\d{2}:\d{2}:\d{2}\+08:00$/);
      const time = Date.parse(source.timestamp);
      assert.ok(Number.isFinite(time) && time > previousTime, 'notifications should form a readable chronology');
      previousTime = time;
      assert.notEqual(source.text, scenario.memory, 'project context is not an incoming notification');
    }
    assert.ok(scenario.summary && scenario.title && scenario.opener && scenario.choices.length);
  }
});

for (const capture of [false, true]) {
  test(`demo enters and replays complete results without touching real data (capture ${capture})`, async () => {
    const h = await fixture(capture);
    try {
      const beforeContext = h.personal.context(h.chatId);
      const beforeMemory = h.projects.readDocument(h.projectId);
      const beforeMessages = h.beta.state().messageCount;
      const entered = h.personal.demoAction({ action: 'enter' });
      assert.equal(entered.state.received, true);
      assert.deepEqual(entered.state.turns, [{ role: 'assistant', content: entered.scenarios[0]!.opener }]);
      assert.doesNotMatch(JSON.stringify(entered), /PRIVATE_DEMO/);
      assert.throws(() => h.personal.state(), /不展示/);
      await assert.rejects(h.personal.analyze(h.chatId), /不能分析/);
      assert.throws(() => h.beta.readAgent(h.chatId), /开启/);
      await h.personal.tick(Date.now() + 60_000);

      for (const scenario of entered.scenarios) {
        const selected = h.personal.demoAction({ action: 'select', scenarioId: scenario.id });
        assert.equal(selected.state.received, true);
        assert.deepEqual(selected.state.turns, [{ role: 'assistant', content: scenario.opener }]);
        assert.equal(selected.state.result, undefined);
        const replied = h.personal.demoAction({ action: 'reply', choice: scenario.choices[0]!.label });
        assert.equal(replied.state.turns.length, 3, 'can choose directly without a receive action');
        assert.ok(replied.state.result);
        assert.deepEqual(h.personal.demoAction({ action: 'receive' }).state, replied.state, 'legacy receive is idempotent after a response');
        const reset = h.personal.demoAction({ action: 'reset' });
        assert.deepEqual(reset.state, selected.state, 'reset restores the complete initial analysis');
        assert.deepEqual(h.personal.demoAction({ action: 'receive' }).state, reset.state, 'legacy receive does not duplicate the opener');
      }

      const beforeInvalid = h.personal.demoState();
      assert.throws(() => h.personal.demoAction({ action: 'select', scenarioId: 'missing' }), /场景无效/);
      assert.deepEqual(h.personal.demoState(), beforeInvalid);
      const last = entered.scenarios.at(-1)!;
      h.personal.demoAction({ action: 'reply', choice: last.choices[1]!.label });
      h.personal.demoAction({ action: 'exit' });
      assert.equal(h.beta.state().enabled, capture);
      const reentered = h.personal.demoAction({ action: 'enter' });
      assert.deepEqual(reentered.state.turns, [{ role: 'assistant', content: last.opener }]);
      assert.equal(reentered.state.result, undefined, 're-entry starts with a complete, fresh analysis');
      h.personal.demoAction({ action: 'exit' });

      assert.equal(h.beta.state().enabled, capture);
      assert.equal(h.beta.state().messageCount, beforeMessages);
      assert.deepEqual(h.personal.context(h.chatId), beforeContext);
      assert.deepEqual(h.projects.readDocument(h.projectId), beforeMemory);
      assert.equal(h.projects.list().length, 1);
      assert.equal(h.store.list('messages').length, 0);
      assert.equal(h.modelCalls(), 0);
    } finally { await h.close(); }
  });
}
