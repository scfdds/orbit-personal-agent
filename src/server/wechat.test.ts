import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { OrbitStore } from './store.ts';
import { WechatContextService } from './wechat.ts';
import { WechatCollector, type WechatCollectorOptions } from './wechat-collector.ts';
import { WechatBetaService, type WechatInterpretGenerator } from './wechat-beta.ts';

const record = (id = '1') => ({ id, chatId: 'contact-a', chatTitle: '方案讨论', sender: '通知中未核验', direction: 'unknown', text: '周五要不要一起看一下方案？时间还没确认。', timestamp: '2026-10-21T09:00:00+08:00' });
function fixture() { const store = new OrbitStore(':memory:'); return { store, context: new WechatContextService(store) }; }
function fakeProcess() {
  const child = new EventEmitter() as ChildProcess;
  const output = new PassThrough();
  Object.assign(child, { stdout: output, exitCode: null, killed: false });
  child.kill = () => { Object.assign(child, { killed: true, exitCode: 0 }); child.emit('exit', 0); return true; };
  return { child, emit: (value: unknown) => output.write(JSON.stringify(value) + '\n'), raw: (value: string) => output.write(value + '\n') };
}
const nextTick = () => new Promise<void>(resolve => setImmediate(resolve));

test('permission retry starts a fresh reader and ignores the old reader after authorization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-wechat-retry-'));
  const { store, context } = fixture(); const children: ReturnType<typeof fakeProcess>[] = [];
  const collector = new WechatCollector(context, directory, () => {}, {
    platform: 'darwin', helperPath: '/fake/reader', spawn: () => {
      const child = fakeProcess(); children.push(child); return child.child;
    },
  });
  const waitForChild = async (count: number) => {
    for (let i = 0; i < 40 && children.length < count; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(children.length, count);
  };
  try {
    collector.start(); await waitForChild(1);
    children[0]!.emit({ type: 'status', status: 'blocked', detail: '请开启 Orbit' });
    children[0]!.child.kill();
    assert.equal(collector.state.permission, 'required');
    collector.start();
    assert.equal(collector.state.permission, 'unknown');
    await waitForChild(2);
    children[1]!.emit({ type: 'status', status: 'listening', detail: '等待通知' });
    // Late output/exit from the denied process must not overwrite the new reader.
    children[0]!.emit({ type: 'status', status: 'blocked', detail: '旧结果' });
    children[0]!.child.emit('exit', 0);
    await nextTick();
    assert.equal(collector.state.status, 'listening');
    assert.equal(collector.state.permission, 'granted');
    collector.start(); assert.equal(children.length, 2);
    assert.equal(context.chats().length, 0);
  } finally { collector.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('imports are atomic and deduplicated; notifications stay out of generic snapshots', () => {
  const { store, context } = fixture();
  try {
    assert.throws(() => context.import({ messages: [record(), { ...record('2'), direction: 'system' }] }));
    assert.equal(context.chats().length, 0);
    assert.deepEqual(context.import({ messages: [record()] }, 'notification'), { inserted: 1, duplicates: 0 });
    assert.deepEqual(context.import({ messages: [record()] }, 'notification'), { inserted: 0, duplicates: 1 });
    assert.equal(context.chats()[0]!.count, 1);
    assert.equal(JSON.stringify(store.snapshot([], 'test', false)).includes('周五要不要'), false);
    assert.equal(store.list('messages').length, 0);
    assert.equal(store.list('memories').length, 0);
    assert.equal(store.list('conversations').length, 0);
    assert.throws(() => context.import({ messages: [{ ...record('3'), timestamp: '2026-10-21' }] }));
  } finally { store.close(); }
});

test('per-chat access is opt-in, revocable and separate from sample data', () => {
  const { store, context } = fixture();
  try {
    context.import({ messages: [record()] }); const chat = context.chats()[0]!;
    assert.deepEqual(context.search('方案'), []);
    assert.throws(() => context.read(chat.id, { agent: true }), /尚未允许/);
    context.patch(chat.id, { enabled: true }); assert.equal(context.search('方案').length, 1);
    context.sample(); const sample = context.chats().find(chat => chat.source === 'sample')!;
    context.patch(sample.id, { enabled: true });
    assert.equal(context.search('').some(result => result.chat.source === 'sample'), false);
    context.patch(chat.id, { enabled: false }); assert.throws(() => context.read(chat.id, { agent: true }));
    assert.equal(context.read(chat.id).messages[0]!.direction, 'unknown');
  } finally { store.close(); }
});

test('pagination preserves equal timestamps and SQL is treated as a literal query', () => {
  const { store, context } = fixture();
  try {
    context.import({ messages: Array.from({ length: 85 }, (_, index) => record(String(index))) });
    const id = context.chats()[0]!.id; const ids: string[] = []; let before: string | undefined;
    do { const page = context.read(id, { before, limit: 17 }); ids.push(...page.messages.map(message => message.id)); before = page.nextCursor || undefined; } while (before);
    assert.equal(ids.length, 85); assert.equal(new Set(ids).size, 85);
    assert.equal(context.read(id, { query: "' OR 1=1 --" }).messages.length, 0);
    assert.throws(() => context.read(id, { limit: NaN }));
  } finally { store.close(); }
});

test('Beta construction is inert and interpretation requires both opt-ins with verified sources', async () => {
  const store = new OrbitStore(':memory:'); let calls = 0;
  const service = new WechatBetaService(store, '/unused', () => {}, async input => {
    calls++;
    const evidence = JSON.parse(input);
    assert.match(evidence.coverage, /不含完整历史/);
    assert.equal(evidence.messages[0].direction, 'unknown');
    return JSON.stringify({ summary: '对方提议周五看方案，具体时间仍待确认。', sourceIds: [evidence.messages[0].id] });
  }, { platform: 'linux' });
  try {
    assert.equal(service.state().enabled, false);
    assert.equal(service.state().collector.status, 'stopped');
    service.context.import({ messages: [record()] }, 'notification');
    const id = service.state().chats[0]!.id;
    assert.throws(() => service.interpret(id), /开启/);
    service.capture(true); // Unsupported platform cannot launch a reader; existing records can still be interpreted.
    assert.equal(service.state().collector.status, 'blocked');
    assert.throws(() => service.interpret(id), /尚未允许/);
    service.patchChat(id, { enabled: true });
    assert.equal(calls, 0);
    const result = await service.interpret(id);
    assert.equal(calls, 1); assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0]!.text, record().text);
    assert.match(result.summary, /待确认/);
    assert.equal(store.list('memories').length, 0);
    assert.equal(store.list('conversations').length, 0);
    service.capture(false);
    assert.deepEqual(service.searchAgent('方案'), []);
    assert.throws(() => service.readAgent(id), /开启/);
  } finally { await service.close(); store.close(); }
});

test('interpretation cannot invent sources or return after its chat is disabled', async () => {
  for (const revoke of [false, true]) {
    const store = new OrbitStore(':memory:'); let finish: ((value: string) => void) | undefined;
    const generate: WechatInterpretGenerator = () => new Promise(resolve => { finish = resolve; });
    const service = new WechatBetaService(store, '/unused', () => {}, generate, { platform: 'linux' });
    try {
      service.context.import({ messages: [record()] }); const id = service.state().chats[0]!.id;
      service.capture(true); service.patchChat(id, { enabled: true });
      const pending = service.interpret(id);
      if (revoke) service.patchChat(id, { enabled: false });
      finish!(JSON.stringify({ summary: '已确认周五完成', sourceIds: ['invented'] }));
      await assert.rejects(pending, revoke ? /取消/ : /来源校验/);
    } finally { await service.close(); store.close(); }
  }
});

test('deletion and clearing cancel interpretation without creating derived memory', async () => {
  const store = new OrbitStore(':memory:'); let finish: ((value: string) => void) | undefined;
  const service = new WechatBetaService(store, '/unused', () => {}, () => new Promise(resolve => { finish = resolve; }), { platform: 'linux' });
  try {
    service.context.import({ messages: [record()] }); const id = service.state().chats[0]!.id;
    service.capture(true); service.patchChat(id, { enabled: true });
    const pending = service.interpret(id); service.clear();
    finish!(JSON.stringify({ summary: '内容', sourceIds: ['id'] }));
    await assert.rejects(pending, /取消/);
    assert.equal(service.state().enabled, false);
    assert.equal(service.state().messageCount, 0);
    assert.equal(service.state().chats.length, 0);
    assert.equal(store.list('memories').length, 0);
  } finally { await service.close(); store.close(); }
});

test('source choices survive restart without automatically launching collection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-wechat-persist-')); let store = new OrbitStore(join(directory, 'test.sqlite'));
  try {
    let service = new WechatBetaService(store, directory, () => {}, undefined, { platform: 'linux' });
    service.context.import({ messages: [record()] }); const id = service.state().chats[0]!.id;
    service.capture(true); service.patchChat(id, { enabled: true }); await service.close(); store.close();
    store = new OrbitStore(join(directory, 'test.sqlite'));
    service = new WechatBetaService(store, directory, () => {}, undefined, { platform: 'linux' });
    assert.equal(service.state().enabled, true);
    assert.equal(service.state().collector.status, 'stopped');
    assert.equal(service.readAgent(id).messages.length, 1);
    await service.close();
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('collector handles permission denial, deduplicates events and stops child on close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-wechat-reader-'));
  const { store, context } = fixture(); const process = fakeProcess(); let launched = 0;
  const collector = new WechatCollector(context, directory, () => {}, { platform: 'darwin', helperPath: '/fake/reader', spawn: (_command, args) => { assert.deepEqual(args, []); launched++; return process.child; } });
  try {
    assert.equal(launched, 0); collector.start();
    for (let index = 0; index < 20 && launched === 0; index++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(launched, 1);
    process.emit({ type: 'status', status: 'listening', detail: '已授权' });
    const event = { type: 'notification', id: 'n1', title: '工作群', body: '讨论一下方案', timestamp: '2026-10-21T10:00:00Z' };
    process.emit(event); process.emit(event); await nextTick();
    assert.equal(context.chats()[0]!.count, 1);
    assert.equal(collector.state.permission, 'granted');
    collector.close(); assert.equal(process.child.killed, true);
    process.emit({ ...event, id: 'after-stop' });
    assert.equal(context.chats()[0]!.count, 1);
  } finally { collector.close(); store.close(); await rm(directory, { recursive: true, force: true }); }

  const other = fixture(); const denied = fakeProcess(); let didLaunch = false;
  const reader = new WechatCollector(other.context, directory, () => {}, { platform: 'darwin', helperPath: '/fake/reader', spawn: () => { didLaunch = true; return denied.child; } });
  try {
    reader.start();
    for (let index = 0; index < 20 && !didLaunch; index++) await new Promise(resolve => setTimeout(resolve, 5));
    denied.emit({ type: 'status', status: 'blocked', detail: '请授予辅助功能权限' });
    denied.child.kill();
    assert.equal(reader.state.status, 'blocked'); assert.equal(reader.state.permission, 'required');
    assert.equal(other.context.chats().length, 0);
  } finally { reader.close(); other.store.close(); await rm(directory, { recursive: true, force: true }); }
});

async function diagnosticReader(changed: () => void = () => {}, mechanism?: WechatCollectorOptions['mechanism']) {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-wechat-diagnostics-'));
  const { store, context } = fixture();
  const children: ReturnType<typeof fakeProcess>[] = [];
  const collector = new WechatCollector(context, directory, changed, {
    platform: 'darwin', mechanism, helperPath: '/fake/reader', spawn: (_command, args) => {
      assert.deepEqual(args, mechanism === 'accessibility' ? ['--request-permission'] : []);
      const process = fakeProcess(); children.push(process); return process.child;
    },
  });
  const start = async () => {
    const count = children.length + 1; collector.start();
    for (let i = 0; i < 40 && children.length < count; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(children.length, count); return children[count - 1]!;
  };
  const process = await start();
  return { collector, context, store, process, start, async close() {
    collector.close(); store.close(); await rm(directory, { recursive: true, force: true });
  } };
}
const nativeCounters = () => ({ processes: 1, windows: 0, nodes: 0, uuidNodes: 0,
  wechatCandidates: 0, parsedCards: 0, emittedCards: 0, traversalLimited: 0, axErrors: { '-25212': 1 } });
const notification = (id = 'diagnostic-1') => ({ type: 'notification', id, title: 'Synthetic private title',
  body: 'Synthetic private body', timestamp: '2026-10-21T10:00:00Z' });

test('collector distinguishes permission from capture and accepts only metadata from native diagnostics', async () => {
  const reader = await diagnosticReader();
  try {
    const { collector, process } = reader;
    process.emit({ type: 'status', status: 'listening', detail: 'Synthetic private status text' });
    assert.equal(collector.state.permission, 'granted');
    assert.equal(collector.state.diagnostics.stage, 'waiting_for_notifications');
    assert.match(collector.state.detail, /尚未收到/);
    assert.equal(collector.state.lastEventAt, null);
    process.emit({ type: 'diagnostics', scannedAt: '2026-10-21T10:00:00Z', title: 'Synthetic private title',
      counters: { ...nativeCounters(), secret: 'Synthetic private body',
        axErrors: { '-25212': 1, '-25299': 2, 'Synthetic private error': 3, description: 'Synthetic private body' } } });
    assert.equal(collector.state.diagnostics.native?.counters.windows, 0);
    assert.deepEqual(collector.state.diagnostics.native?.counters.axErrors, { '-25212': 1 });
    assert.equal(collector.state.diagnostics.linesReceived, 2);
    assert.equal(collector.state.diagnostics.eventsParsed, 2);
    assert.equal(collector.state.diagnostics.notificationsReceived, 0);
    assert.equal(collector.state.diagnostics.stage, 'waiting_for_notifications');
    assert.equal(JSON.stringify(collector.state).includes('Synthetic private'), false);
    const previous = collector.state.diagnostics.native;
    process.emit({ type: 'diagnostics', scannedAt: '2026-10-21T10:00:00Z', counters: { ...nativeCounters(), nodes: -1 } });
    assert.deepEqual(collector.state.diagnostics.native, previous);
    assert.equal(collector.state.diagnostics.lastError?.category, 'invalid_diagnostics');
    assert.equal(collector.state.diagnostics.rejectedEvents, 1);
  } finally { await reader.close(); }
});

test('collector records invalid output and validation failures without retaining private content', async () => {
  const reader = await diagnosticReader();
  try {
    const { collector, context, process } = reader;
    process.emit(notification('before-ready'));
    assert.equal(collector.state.diagnostics.ignoredNotifications, 1);
    assert.equal(collector.state.diagnostics.lastError?.category, 'notification_before_ready');
    process.emit({ type: 'status', status: 'listening' });
    process.raw('not JSON: Synthetic private body');
    assert.equal(collector.state.diagnostics.lastError?.category, 'invalid_json');
    process.raw('x'.repeat(64001));
    assert.equal(collector.state.diagnostics.lastError?.category, 'event_too_large');
    process.emit(null);
    assert.equal(collector.state.diagnostics.lastError?.category, 'invalid_event');
    process.emit({ ...notification(), timestamp: 'Synthetic private invalid date' });
    assert.equal(collector.state.diagnostics.lastError?.category, 'invalid_notification');
    assert.equal(collector.state.diagnostics.linesReceived, 6);
    assert.equal(collector.state.diagnostics.notificationsReceived, 2);
    assert.equal(collector.state.diagnostics.rejectedEvents, 4);
    assert.equal(collector.state.diagnostics.importFailures, 1);
    assert.equal(collector.state.lastEventAt, null);
    assert.equal(context.chats().length, 0);
    assert.equal(JSON.stringify(collector.state).includes('Synthetic private'), false);
    process.emit(notification('valid'));
    process.emit(notification('valid'));
    assert.equal(collector.state.diagnostics.stage, 'saved');
    assert.equal(collector.state.diagnostics.messagesInserted, 1);
    assert.equal(collector.state.diagnostics.duplicates, 1);
    assert.equal(context.chats()[0]?.count, 1);
    assert.ok(collector.state.lastEventAt);
    assert.equal(JSON.stringify(collector.state).includes('Synthetic private'), false);
  } finally { await reader.close(); }
});

test('collector reports storage errors separately and does not misclassify callback errors as failed writes', async () => {
  let callbackFails = false;
  const reader = await diagnosticReader(() => { if (callbackFails) throw new Error('Synthetic private callback'); });
  try {
    const { collector, context, process } = reader;
    process.emit({ type: 'status', status: 'listening' });
    const realImport = context.import.bind(context);
    context.import = () => { throw Object.assign(new Error('Synthetic private database text'), { code: 'ERR_SQLITE_ERROR' }); };
    process.emit(notification());
    assert.equal(collector.state.diagnostics.lastError?.category, 'storage_failed');
    assert.equal(collector.state.diagnostics.importFailures, 1);
    assert.equal(collector.state.diagnostics.messagesInserted, 0);
    context.import = () => { throw new Error('Synthetic private unexpected text'); };
    process.emit(notification());
    assert.equal(collector.state.diagnostics.lastError?.category, 'import_failed');
    assert.equal(collector.state.diagnostics.importFailures, 2);
    assert.equal(JSON.stringify(collector.state).includes('Synthetic private'), false);
    context.import = realImport;
    callbackFails = true;
    process.emit(notification());
    assert.equal(context.chats()[0]?.count, 1);
    assert.equal(collector.state.diagnostics.messagesInserted, 1);
    assert.equal(collector.state.diagnostics.importFailures, 2);
    assert.equal(collector.state.diagnostics.callbackFailures, 1);
    assert.equal(collector.state.diagnostics.lastError?.category, 'state_callback_failed');
    assert.equal(JSON.stringify(collector.state).includes('Synthetic private'), false);
    callbackFails = false;
    process.emit(notification('recovered'));
    assert.equal(collector.state.diagnostics.stage, 'saved');
    assert.equal(collector.state.diagnostics.messagesInserted, 2);
  } finally { callbackFails = false; await reader.close(); }
});

test('collector preserves diagnostics on stop, resets on restart and ignores stale process output', async () => {
  const reader = await diagnosticReader();
  try {
    const { collector, process } = reader;
    process.emit({ type: 'status', status: 'listening' });
    process.emit(notification());
    collector.stop();
    assert.equal(collector.state.diagnostics.stage, 'idle');
    assert.equal(collector.state.diagnostics.messagesInserted, 1);
    process.raw('Synthetic private stale output');
    assert.equal(collector.state.diagnostics.linesReceived, 2);
    const fresh = await reader.start();
    assert.equal(collector.state.diagnostics.stage, 'starting');
    assert.equal(collector.state.diagnostics.linesReceived, 0);
    assert.equal(collector.state.diagnostics.messagesInserted, 0);
    process.emit(notification('stale'));
    process.child.emit('exit', 1);
    assert.equal(collector.state.diagnostics.linesReceived, 0);
    assert.equal(collector.state.status, 'starting');
    fresh.emit({ type: 'status', status: 'listening' });
    fresh.child.kill();
    assert.equal(collector.state.status, 'error');
    assert.equal(collector.state.diagnostics.lastError?.category, 'reader_exited');
  } finally { await reader.close(); }
});

test('database collection is the default and reports FDA and database failures without falling back', async () => {
  const reader = await diagnosticReader();
  try {
    const { collector, context, process } = reader;
    assert.equal(collector.state.mechanism, 'notification_database');
    process.emit({ type: 'status', status: 'blocked', reason: 'full_disk_access', detail: 'Synthetic private status' });
    assert.equal(collector.state.status, 'blocked');
    assert.equal(collector.state.permission, 'required');
    assert.equal(collector.state.diagnostics.lastError?.category, 'full_disk_access');
    assert.match(collector.state.detail, /完全磁盘访问.*Orbit/);
    assert.doesNotMatch(collector.state.detail, /辅助功能/);
    for (const [reason, text] of [
      ['database_missing', /尚未找到/], ['schema_unsupported', /格式尚不支持/],
      ['database_busy', /正在使用中/], ['database_read_failed', /读取失败/],
    ] as const) {
      process.emit({ type: 'status', status: 'error', reason });
      assert.equal(collector.state.status, 'error');
      assert.equal(collector.state.diagnostics.lastError?.category, reason);
      assert.match(collector.state.detail, text);
      assert.equal(collector.state.mechanism, 'notification_database');
    }
    process.emit({ type: 'status', status: 'error', reason: 'Synthetic private reason' });
    assert.equal(collector.state.diagnostics.lastError?.category, 'database_read_failed');
    assert.equal(JSON.stringify(collector.state).includes('Synthetic private'), false);
    assert.equal(context.chats().length, 0);
    // A fresh successful poll can recover, without requesting Accessibility.
    process.emit({ type: 'status', status: 'listening' });
    assert.equal(collector.state.status, 'listening');
    assert.equal(collector.state.permission, 'granted');
  } finally { await reader.close(); }
});

test('database diagnostics retain only safe aggregates and do not alter capture state or broadcast', async () => {
  let changed = 0;
  const reader = await diagnosticReader(() => { changed++; });
  try {
    const { collector, process } = reader;
    process.emit({ type: 'status', status: 'listening' });
    const before = changed;
    const diagnostic = { type: 'db_diagnostics', scannedAt: '2026-10-21T10:00:00+08:00',
      rowsRead: 5, parsedRecords: 3, emittedRecords: 2, invalidRecords: 2, limited: 0,
      title: 'Synthetic private title', body: 'Synthetic private body', databasePath: '/private/notification.db' };
    process.emit(diagnostic);
    assert.deepEqual(collector.state.diagnostics.database, { scannedAt: '2026-10-21T02:00:00.000Z',
      rowsRead: 5, parsedRecords: 3, emittedRecords: 2, invalidRecords: 2, limited: 0 });
    assert.equal(changed, before);
    assert.equal(collector.state.status, 'listening');
    assert.equal(collector.state.diagnostics.stage, 'waiting_for_notifications');
    assert.equal(collector.state.diagnostics.notificationsReceived, 0);
    assert.equal(collector.state.diagnostics.messagesInserted, 0);
    assert.equal(collector.state.lastEventAt, null);
    assert.equal(JSON.stringify(collector.state).includes('Synthetic private'), false);
    assert.equal(JSON.stringify(collector.state).includes('/private/notification.db'), false);
    const previous = collector.state.diagnostics.database;
    for (const patch of [{ rowsRead: -1 }, { parsedRecords: 1.5 }, { emittedRecords: '2' },
      { invalidRecords: 1e20 }, { limited: 2 }, { scannedAt: 'invalid' }]) {
      process.emit({ ...diagnostic, ...patch });
      assert.equal(collector.state.diagnostics.lastError?.category, 'invalid_diagnostics');
      assert.deepEqual(collector.state.diagnostics.database, previous);
    }
    assert.equal(collector.state.diagnostics.rejectedEvents, 6);
    assert.equal(reader.context.chats().length, 0);
  } finally { await reader.close(); }
});

test('database notification delivery times survive import and retries stay idempotent', async () => {
  const reader = await diagnosticReader();
  try {
    const { collector, context, process } = reader;
    process.emit({ type: 'status', status: 'listening' });
    const delivered = { ...notification('notification-db:synthetic-id'), timestamp: '2026-10-20T23:45:00+08:00' };
    process.emit(delivered); process.emit(delivered);
    const chat = context.chats()[0]!;
    assert.equal(chat.count, 1);
    assert.equal(chat.enabled, false);
    assert.deepEqual(context.search(''), []);
    const data = context.read(chat.id);
    assert.equal(data.messages[0]?.timestamp, '2026-10-20T15:45:00.000Z');
    assert.match(data.coverage, /时间为系统投递时间，不等于聊天发送时间/);
    assert.doesNotMatch(data.coverage, /捕获时间/);
    assert.equal(collector.state.diagnostics.messagesInserted, 1);
    assert.equal(collector.state.diagnostics.duplicates, 1);
    // Existing AX records must not be relabeled as verified delivery timestamps.
    process.emit(notification('notification-center:legacy-id'));
    assert.match(context.read(chat.id).coverage, /旧版记录的时间来源未核验/);
    assert.equal(reader.store.list('messages').length, 0);
    assert.equal(reader.store.list('memories').length, 0);
  } finally { await reader.close(); }
});

test('legacy Accessibility reader requires explicit selection and keeps native diagnostics compatibility', async () => {
  let changed = 0;
  const reader = await diagnosticReader(() => { changed++; }, 'accessibility');
  try {
    const { collector, process } = reader;
    assert.equal(collector.state.mechanism, 'accessibility');
    process.emit({ type: 'status', status: 'blocked' });
    assert.match(collector.state.detail, /辅助功能/);
    assert.doesNotMatch(collector.state.detail, /完全磁盘访问/);
    process.emit({ type: 'status', status: 'listening' });
    const before = changed;
    process.emit({ type: 'diagnostics', scannedAt: '2026-10-21T10:00:00Z', counters: nativeCounters() });
    assert.equal(collector.state.diagnostics.native?.counters.processes, 1);
    assert.equal(collector.state.diagnostics.database, null);
    assert.equal(changed, before);
    process.emit(notification('notification-center:legacy-id'));
    assert.equal(collector.state.diagnostics.messagesInserted, 1);
  } finally { await reader.close(); }
});

test('default helper path and compiler fallback select the database reader, never the legacy binary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-wechat-db-launch-'));
  const { store, context } = fixture();
  const commands: { command: string; args: string[] }[] = [];
  let readerProcess: ReturnType<typeof fakeProcess> | undefined;
  const previous = process.env.ORBIT_WECHAT_HELPER;
  delete process.env.ORBIT_WECHAT_HELPER;
  const collector = new WechatCollector(context, directory, () => {}, { platform: 'darwin', spawn: (command, args) => {
    commands.push({ command, args });
    const child = fakeProcess();
    if (command === '/usr/bin/swiftc') {
      assert.ok(args[0]?.endsWith('/scripts/native/wechat-notification-db.swift'));
      assert.ok(args.includes('-lsqlite3'));
      assert.ok(args.at(-1)?.endsWith('/native/orbit-wechat-db-reader'));
      setImmediate(() => { Object.assign(child.child, { exitCode: 0 }); child.child.emit('exit', 0); });
    } else {
      assert.ok(command.endsWith('/orbit-wechat-db-reader'));
      assert.deepEqual(args, []);
      readerProcess = child;
    }
    return child.child;
  } });
  try {
    collector.start();
    for (let i = 0; i < 60 && !readerProcess; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(readerProcess);
    readerProcess.emit({ type: 'status', status: 'error', reason: 'database_missing' });
    const count = commands.length;
    await nextTick();
    assert.equal(commands.length, count);
    assert.equal(commands.some(item => item.command.endsWith('/orbit-wechat-reader')), false);
    assert.equal(collector.state.status, 'error');
  } finally {
    collector.close(); store.close();
    if (previous === undefined) delete process.env.ORBIT_WECHAT_HELPER;
    else process.env.ORBIT_WECHAT_HELPER = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('successful notification retries skip SQL and broadcasts, failed imports retry, and restart resets the cache', async () => {
  let broadcasts = 0;
  const reader = await diagnosticReader(() => { broadcasts++; });
  try {
    const { collector, context, process } = reader;
    const realImport = context.import.bind(context); let imports = 0; let fail = true;
    context.import = (input, source) => {
      imports++;
      if (fail) throw Object.assign(new Error('Synthetic private storage error'), { code: 'ERR_SQLITE_ERROR' });
      return realImport(input, source);
    };
    process.emit({ type: 'status', status: 'listening' });
    const event = notification('notification-db:retry-fixture');
    process.emit(event);
    assert.equal(imports, 1);
    assert.equal(collector.state.diagnostics.importFailures, 1);
    fail = false;
    process.emit(event);
    assert.equal(imports, 2);
    assert.equal(collector.state.diagnostics.messagesInserted, 1);
    const before = broadcasts;
    process.emit(event); process.emit(event);
    assert.equal(imports, 2);
    assert.equal(broadcasts, before);
    assert.equal(collector.state.diagnostics.duplicates, 2);
    assert.equal(context.chats()[0]?.count, 1);
    collector.stop();
    const fresh = await reader.start();
    fresh.emit({ type: 'status', status: 'listening' });
    fresh.emit(event);
    assert.equal(imports, 3);
    assert.equal(collector.state.diagnostics.messagesInserted, 0);
    assert.equal(collector.state.diagnostics.duplicates, 1);
    assert.equal(context.chats()[0]?.count, 1);
  } finally { await reader.close(); }
});

test('successful notification ID cache is bounded', async () => {
  const reader = await diagnosticReader();
  try {
    let imports = 0;
    reader.context.import = () => { imports++; return { inserted: 1, duplicates: 0 }; };
    reader.process.emit({ type: 'status', status: 'listening' });
    for (let i = 0; i <= 5000; i++) reader.process.emit(notification(`notification-db:bounded-${i}`));
    assert.equal(imports, 5001);
    reader.process.emit(notification('notification-db:bounded-5000'));
    assert.equal(imports, 5001);
    reader.process.emit(notification('notification-db:bounded-0'));
    assert.equal(imports, 5002);
  } finally { await reader.close(); }
});
