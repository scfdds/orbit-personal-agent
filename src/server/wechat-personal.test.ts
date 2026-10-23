import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrbitStore } from './store.ts';
import { ProjectService } from './projects.ts';
import { WechatBetaService } from './wechat-beta.ts';
import { WechatPersonalService, type PersonalGenerator } from './wechat-personal.ts';
import { personalApi } from './personal-api.ts';
import type { OrbitRuntime } from './runtime.ts';

async function fixture(generate?: PersonalGenerator) {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-wechat-personal-'));
  const store = new OrbitStore(':memory:');
  const beta = new WechatBetaService(store, dir, undefined, undefined, { platform: 'linux' });
  const projects = new ProjectService(store, () => {}, undefined, dir);
  const personal = new WechatPersonalService(store, beta, projects, undefined, generate || (async input => {
    const data = JSON.parse(input);
    return JSON.stringify({ summary: '周末出游时间有变化', title: '出发时间需要确认', opener: '这与原来安排有冲突，可以先比较两个方案。', suggestions: ['比较两种安排'], sourceIds: [data.messages[0].id] });
  }));
  beta.context.import({ messages: [{ id: 'one', chatId: 'a', chatTitle: 'PRIVATE_TEST_CONTACT', sender: '小夏', direction: 'incoming', text: '我只能下午两点出发', timestamp: '2026-10-21T10:00:00Z' }] }, 'notification');
  const id = beta.state().chats[0]!.id;
  return { store, beta, projects, personal, id, async allow() { beta.capture(true); beta.patchChat(id, { enabled: true }); }, async close() { await personal.close(); await beta.close(); await projects.close(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test('analysis requires opt-in; reads only linked project, preserves editable context and never writes project memory', async () => {
  let seen = '';
  const h = await fixture(async input => { seen = input; const d = JSON.parse(input); return JSON.stringify({ summary: '改变出发时间', title: '安排可能有变', opener: '先确认新的集合时间。', suggestions: [], sourceIds: [d.messages[0].id] }); });
  try {
    await assert.rejects(h.personal.analyze(h.id), /开启/);
    await h.allow();
    const trip = h.projects.create({ name: '旅行' }); const other = h.projects.create({ name: '绝不混入' });
    h.projects.saveDocument(trip.id, 0, '# 已确认背景\nTRIP_ONLY: 十点出发');
    h.projects.saveDocument(other.id, 0, '# 另一项目\nSECRET_UNRELATED');
    h.personal.patch(h.id, { version: 0, background: '朋友约着出游', projectId: trip.id, watching: true });
    const before = h.projects.readDocument(trip.id);
    const topic = await h.personal.analyze(h.id);
    assert.match(seen, /TRIP_ONLY/); assert.doesNotMatch(seen, /SECRET_UNRELATED/);
    assert.equal(h.personal.context(h.id).background, '朋友约着出游');
    assert.equal(h.projects.readDocument(trip.id).content, before.content);
    assert.equal(h.personal.pending().length, 1);
    assert.equal(h.store.list('messages').length, 0);
    assert.equal((await h.personal.analyze(h.id)).id, topic.id, 'same evidence reuses result');
    assert.throws(() => h.personal.patch(h.id, { version: 0, background: 'stale' }), /刷新/);
    h.beta.patchChat(h.id, { enabled: false });
    assert.equal(h.personal.pending().length, 0);
    await assert.rejects(h.personal.analyze(h.id), /允许/);
  } finally { await h.close(); }
});

test('rejects fabricated sources and discards output after access revoked, even if generator ignores abort', async () => {
  const invalid = await fixture(async () => JSON.stringify({ summary: '概述', title: '标题', opener: '说明', suggestions: [], sourceIds: ['fake'] }));
  try { await invalid.allow(); await assert.rejects(invalid.personal.analyze(invalid.id), /来源/); assert.equal(invalid.personal.topic(invalid.id), undefined); } finally { await invalid.close(); }
  let release!: (value: string) => void; let source = '';
  const h = await fixture(input => { source = JSON.parse(input).messages[0].id; return new Promise(resolve => { release = resolve; }); });
  try {
    await h.allow(); const job = h.personal.analyze(h.id);
    h.beta.patchChat(h.id, { enabled: false });
    release(JSON.stringify({ summary: '概述', title: '标题', opener: '说明', suggestions: [], sourceIds: [source] }));
    await assert.rejects(job, /允许/); assert.equal(h.personal.topic(h.id), undefined);
  } finally { await h.close(); }
});

test('demo has three isolated replayable flows, blocks real access, and restores capture preference', async () => {
  const h = await fixture();
  try {
    await h.allow(); const count = h.beta.state().messageCount;
    const demo = h.personal.demoAction({ action: 'enter' });
    assert.equal(demo.scenarios.length, 3);
    assert.doesNotMatch(JSON.stringify(demo), /PRIVATE_TEST_CONTACT/);
    assert.throws(() => h.personal.state(), /不展示/);
    await assert.rejects(h.personal.analyze(h.id), /不能分析/);
    assert.throws(() => h.beta.readAgent(h.id), /开启/);
    assert.throws(() => h.beta.capture(true), /退出演示/);
    for (const scenario of demo.scenarios) {
      h.personal.demoAction({ action: 'select', scenarioId: scenario.id });
      const received = h.personal.demoAction({ action: 'receive' }); assert.equal(received.state.turns.length, 1);
      assert.equal(h.personal.demoAction({ action: 'receive' }).state.turns.length, 1);
      const reply = h.personal.demoAction({ action: 'reply', choice: scenario.choices[0]!.label }); assert.equal(reply.state.turns.length, 3); assert.ok(reply.state.result);
      assert.throws(() => h.personal.demoAction({ action: 'reply', choice: scenario.choices[0]!.label }), /重播/);
      assert.equal(h.personal.demoAction({ action: 'reset' }).state.turns.length, 1);
    }
    h.personal.demoAction({ action: 'exit' });
    assert.equal(h.beta.state().enabled, true); assert.equal(h.beta.state().messageCount, count);
    assert.equal(h.store.list('messages').length, 0); assert.equal(h.projects.list().length, 0);
  } finally { await h.close(); }
});

test('background analysis debounces new messages and requires watching, with per-contact rate limit', async () => {
  let calls = 0;
  const h = await fixture(async input => { calls++; const d = JSON.parse(input); return JSON.stringify({ summary: '普通消息', title: '', opener: '', suggestions: [], sourceIds: [d.messages[0].id] }); });
  try {
    await h.allow(); const now = Date.now();
    await h.personal.tick(now); await h.personal.tick(now + 20000); assert.equal(calls, 0);
    h.personal.patch(h.id, { version: 0, watching: true });
    await h.personal.tick(now); await h.personal.tick(now + 10000); assert.equal(calls, 0);
    await h.personal.tick(now + 16000); assert.equal(calls, 1); assert.equal(h.personal.pending().length, 0);
    await h.personal.tick(now + 40000); assert.equal(calls, 1);
    h.beta.capture(false); await h.personal.tick(now + 400000); assert.equal(calls, 1);
  } finally { await h.close(); }
});

test('edits cancel in-flight analysis; deletion removes contact context and topic', async () => {
  let release!: (value: string) => void; let source = '';
  const h = await fixture(input => { source = JSON.parse(input).messages[0].id; return new Promise(resolve => { release = resolve; }); });
  try {
    await h.allow(); const job = h.personal.analyze(h.id);
    h.personal.patch(h.id, { version: 0, background: '更正的背景' });
    release(JSON.stringify({ summary: '概述', title: '标题', opener: '说明', suggestions: [], sourceIds: [source] }));
    await assert.rejects(job, /取消/); assert.equal(h.personal.topic(h.id), undefined);
    h.personal.invalidate(h.id, true); h.beta.remove(h.id);
    assert.equal(h.personal.context(h.id).background, ''); assert.equal(h.personal.state().contacts.length, 0);
  } finally { await h.close(); }
});

test('main conversation handoff is explicit, idempotent and contains verified references; context changes invalidate the old analysis', async () => {
  const h = await fixture();
  try {
    await h.allow(); const topic = await h.personal.analyze(h.id);
    const main = h.store.createConversation('主对话');
    const result = h.personal.handoff(h.id, topic.id, main.id);
    assert.equal(h.personal.handoff(h.id, topic.id, main.id).messageId, result.messageId);
    assert.equal(h.store.list('messages').length, 1);
    assert.match(h.store.list('messages')[0]!.content, /外部引用/);
    assert.match(h.store.list('messages')[0]!.content, /下午两点/);
    assert.equal(h.personal.pending().length, 0);
    h.personal.patch(h.id, { version: 0, background: '改为另一个周末' });
    assert.equal(h.personal.topic(h.id), undefined);
    assert.throws(() => h.personal.handoff(h.id, topic.id, main.id), /已更新/);
  } finally { await h.close(); }
});

test('context and permission changes validate atomically', async () => {
  const h = await fixture();
  try {
    assert.throws(() => h.personal.patch(h.id, { version: 10, enabled: true, watching: true }), /刷新/);
    assert.equal(h.beta.context.chat(h.id).enabled, false);
    h.personal.patch(h.id, { version: 0, enabled: true, watching: true, background: '共同旅行' });
    assert.equal(h.beta.context.chat(h.id).enabled, true); assert.equal(h.personal.context(h.id).watching, true);
    h.personal.patch(h.id, { version: 1, enabled: false });
    assert.equal(h.beta.context.chat(h.id).enabled, false); assert.equal(h.personal.context(h.id).watching, false);
  } finally { await h.close(); }
});

function watchingSnapshot(personal: WechatPersonalService) {
  return personal.state().contacts.map(contact => ({ id: contact.id, version: contact.context.version, enabled: contact.enabled }));
}

test('bulk watching applies only to displayed real chats and preserves background, project and capture preference', async () => {
  let calls = 0;
  const h = await fixture(async () => { calls++; throw new Error('Must not call a model when changing settings'); });
  try {
    const project = h.projects.create({ name: '旅行背景' });
    h.projects.saveDocument(project.id, 0, '# 计划\n十点出发');
    h.personal.patch(h.id, { version: 0, background: '共同旅行', projectId: project.id });
    const memoryBefore = h.projects.readDocument(project.id);
    h.beta.context.import({ messages: [{ id: 'sample-one', chatId: 'sample', chatTitle: 'SAMPLE_CHAT', sender: '示例', direction: 'incoming', text: '示例消息', timestamp: '2026-10-21T10:00:00Z' }] }, 'sample');
    assert.equal(h.beta.context.chat(h.id).enabled, false);
    assert.equal(h.personal.context(h.id).watching, false);
    const contacts = watchingSnapshot(h.personal);
    // A new chat arriving while the settings request is in flight is outside its snapshot.
    h.beta.context.import({ messages: [{ id: 'later-one', chatId: 'later', chatTitle: 'NEW_CHAT', sender: '后来', direction: 'incoming', text: '新聊天消息', timestamp: '2026-10-21T11:00:00Z' }] }, 'notification');
    const state = h.personal.setWatching({ enabled: true, contacts });
    const current = state.contacts.find(contact => contact.id === h.id)!;
    const later = state.contacts.find(contact => contact.title === 'NEW_CHAT')!;
    assert.equal(current.enabled, true); assert.equal(current.context.watching, true);
    assert.equal(current.context.background, '共同旅行'); assert.equal(current.context.projectId, project.id);
    assert.equal(later.enabled, false); assert.equal(later.context.watching, false);
    assert.equal(h.beta.state().chats.find(chat => chat.source === 'sample')!.enabled, false);
    assert.equal(h.beta.state().enabled, false, 'analysis settings do not enable capture');
    assert.deepEqual(h.projects.readDocument(project.id), memoryBefore);
    const unchangedVersion = current.context.version;
    h.personal.setWatching({ enabled: true, contacts: watchingSnapshot(h.personal).filter(contact => contact.id === h.id) });
    assert.equal(h.personal.context(h.id).version, unchangedVersion, 'repeating a saved value does not cancel or restart work');
    h.personal.setWatching({ enabled: false, contacts: watchingSnapshot(h.personal) });
    assert.ok(h.personal.state().contacts.every(contact => !contact.enabled && !contact.context.watching));
    assert.equal(h.personal.context(h.id).background, '共同旅行');
    assert.equal(calls, 0); assert.equal(h.store.list('messages').length, 0);
  } finally { await h.close(); }
});

test('bulk watching validates every version and permission before changing any chat', async () => {
  const h = await fixture();
  try {
    h.beta.context.import({ messages: [{ id: 'second-one', chatId: 'second', chatTitle: 'SECOND_CHAT', sender: '二', direction: 'incoming', text: '第二个聊天', timestamp: '2026-10-21T09:00:00Z' }] }, 'notification');
    const contacts = watchingSnapshot(h.personal);
    const second = contacts.find(contact => contact.id !== h.id)!;
    h.personal.patch(second.id, { version: second.version, background: '刚更新的背景' });
    assert.throws(() => h.personal.setWatching({ enabled: true, contacts }), /刷新/);
    assert.ok(h.personal.state().contacts.every(contact => !contact.enabled && !contact.context.watching));
    assert.equal(h.personal.context(h.id).version, 0, 'earlier entries were not partly saved');
    const current = watchingSnapshot(h.personal);
    h.beta.patchChat(second.id, { enabled: true });
    assert.throws(() => h.personal.setWatching({ enabled: true, contacts: current }), /刷新/);
    assert.equal(h.beta.context.chat(h.id).enabled, false);
    assert.throws(() => h.personal.setWatching({ enabled: true, contacts: [current[0], current[0]] }), /版本/);
    assert.throws(() => h.personal.setWatching({ enabled: 'true', contacts: current }), /布尔值/);
    assert.throws(() => h.personal.setWatching({ enabled: true, contacts: [] }), /当前聊天/);
  } finally { await h.close(); }
});

test('bulk disabling aborts pending analysis and discards output even after re-enabling', async () => {
  let release!: (value: string) => void; let source = ''; let signal!: AbortSignal;
  const h = await fixture((input, requestSignal) => { source = JSON.parse(input).messages[0].id; signal = requestSignal; return new Promise(resolve => { release = resolve; }); });
  try {
    await h.allow();
    h.personal.setWatching({ enabled: true, contacts: watchingSnapshot(h.personal) });
    const job = h.personal.analyze(h.id);
    h.personal.setWatching({ enabled: false, contacts: watchingSnapshot(h.personal) });
    assert.equal(signal.aborted, true);
    assert.equal(h.personal.pending().length, 0);
    h.personal.setWatching({ enabled: true, contacts: watchingSnapshot(h.personal) });
    release(JSON.stringify({ summary: '旧概述', title: '旧标题', opener: '旧说明', suggestions: [], sourceIds: [source] }));
    await assert.rejects(job, /取消/);
    assert.equal(h.personal.topic(h.id), undefined);
    assert.equal(h.beta.state().enabled, true, 'disabling analysis does not disable capture');
  } finally { await h.close(); }
});

test('bulk watching API blocks demo mode and leaves real settings untouched', async () => {
  const h = await fixture();
  try {
    const contacts = watchingSnapshot(h.personal);
    const runtime = { wechatPersonal: h.personal } as OrbitRuntime;
    const route = '/api/wechat/contacts/watching';
    h.personal.demoAction({ action: 'enter' });
    await assert.rejects(personalApi(runtime, route, 'PATCH', async () => ({ enabled: true, contacts })), /退出演示/);
    assert.equal(h.beta.context.chat(h.id).enabled, false); assert.equal(h.personal.context(h.id).version, 0);
    h.personal.demoAction({ action: 'exit' });
    assert.equal((await personalApi(runtime, route, 'PATCH', async () => ({ enabled: true, contacts })))!.status, 200);
    assert.equal(h.beta.context.chat(h.id).enabled, true); assert.equal(h.personal.context(h.id).watching, true);
    await assert.rejects(personalApi(runtime, route, 'POST', async () => ({})), /不支持/);
    assert.equal(h.store.list('messages').length, 0);
  } finally { await h.close(); }
});

for (const change of ['memory', 'summary', 'archive', 'delete'] as const) {
  test(`discards in-flight analysis when linked project ${change} changes`, async () => {
    let release!: (value: string) => void; let source = '';
    const h = await fixture(input => { source = JSON.parse(input).messages[0].id; return new Promise(resolve => { release = resolve; }); });
    try {
      await h.allow();
      const project = h.projects.create({ name: '周末旅行', summary: '周六出发' });
      h.projects.saveDocument(project.id, 0, '# 旅行安排\n周六十点出发');
      h.personal.patch(h.id, { version: 0, projectId: project.id });
      const job = h.personal.analyze(h.id);
      if (change === 'memory') h.projects.saveDocument(project.id, h.projects.readDocument(project.id).version, '# 旅行安排\n已改为周日出发');
      else if (change === 'summary') h.projects.update(project.id, { summary: '已改为周日出发' });
      else if (change === 'archive') h.projects.update(project.id, { archived: true });
      else h.projects.delete(project.id);
      release(JSON.stringify({ summary: '概述', title: '周六安排需要调整', opener: '原定周六十点出发。', suggestions: [], sourceIds: [source] }));
      await assert.rejects(job, /项目背景已更新/);
      assert.equal(h.personal.topic(h.id), undefined);
      assert.equal(h.store.list('messages').length, 0);
    } finally { await h.close(); }
  });

  test(`rejects handoff after linked project ${change} changes`, async () => {
    const h = await fixture();
    try {
      await h.allow();
      const project = h.projects.create({ name: '周末旅行', summary: '周六出发' });
      h.projects.saveDocument(project.id, 0, '# 旅行安排\n周六十点出发');
      h.personal.patch(h.id, { version: 0, projectId: project.id });
      const topic = await h.personal.analyze(h.id);
      const main = h.store.createConversation('主对话');
      if (change === 'memory') h.projects.saveDocument(project.id, h.projects.readDocument(project.id).version, '# 旅行安排\n已改为周日出发');
      else if (change === 'summary') h.projects.update(project.id, { summary: '已改为周日出发' });
      else if (change === 'archive') h.projects.update(project.id, { archived: true });
      else h.projects.delete(project.id);
      assert.throws(() => h.personal.handoff(h.id, topic.id, main.id), /项目背景已更新/);
      assert.equal(h.store.list('messages').length, 0);
      const current = await h.personal.analyze(h.id);
      assert.notEqual(current.id, topic.id, 'refresh does not reuse the stale analysis');
      assert.ok(h.personal.handoff(h.id, current.id, main.id).messageId);
    } finally { await h.close(); }
  });
}

test('new messages and unrelated project edits preserve valid earlier evidence and allow handoff', async () => {
  let release!: (value: string) => void; let source = '';
  const h = await fixture(input => { source = JSON.parse(input).messages[0].id; return new Promise(resolve => { release = resolve; }); });
  try {
    await h.allow();
    const project = h.projects.create({ name: '周末旅行' });
    const other = h.projects.create({ name: '摄影选题' });
    h.personal.patch(h.id, { version: 0, projectId: project.id });
    const job = h.personal.analyze(h.id);
    h.projects.saveDocument(other.id, 0, '# 摄影选题\n更改本周计划');
    const messages = Array.from({ length: 25 }, (_, index) => ({ id: `later-${index}`, chatId: 'a', chatTitle: 'PRIVATE_TEST_CONTACT', sender: '小夏', direction: 'incoming', text: '补充一条其他信息', timestamp: new Date(Date.parse('2026-10-21T11:00:00Z') + index * 1000).toISOString() }));
    h.beta.context.import({ messages: messages.slice(0, 10) }, 'notification');
    release(JSON.stringify({ summary: '概述', title: '出发时间需要确认', opener: '小夏只能下午两点出发。', suggestions: [], sourceIds: [source] }));
    const topic = await job;
    h.beta.context.import({ messages: messages.slice(10) }, 'notification');
    const main = h.store.createConversation('主对话');
    const result = h.personal.handoff(h.id, topic.id, main.id);
    assert.ok(result.messageId);
    assert.equal(h.store.list('messages').length, 1);
    assert.match(h.store.list('messages')[0]!.content, /下午两点/);
    assert.equal(h.personal.handoff(h.id, topic.id, main.id).messageId, result.messageId);
  } finally { await h.close(); }
});

test('legacy topics without a background fingerprint require refresh before handoff', async () => {
  const h = await fixture();
  try {
    await h.allow();
    const topic = await h.personal.analyze(h.id);
    const saved = h.personal.topic(h.id)!;
    delete saved.backgroundFingerprint;
    h.store.db.prepare('UPDATE wechat_topics SET value=? WHERE id=?').run(JSON.stringify(saved), h.id);
    const main = h.store.createConversation('主对话');
    assert.throws(() => h.personal.handoff(h.id, topic.id, main.id), /重新分析/);
    const refreshed = await h.personal.analyze(h.id);
    assert.notEqual(refreshed.id, topic.id);
    assert.ok(h.personal.handoff(h.id, refreshed.id, main.id).messageId);
  } finally { await h.close(); }
});
