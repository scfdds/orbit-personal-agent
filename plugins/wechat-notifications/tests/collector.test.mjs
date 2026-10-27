import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NotificationCollector } from '../src/collector.mjs';
import { NotificationStore } from '../src/store.mjs';
import { DEFAULT_CONFIG } from '../src/config.mjs';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const ready = { type: 'status', status: 'listening' };
const diagnostics = { type: 'db_diagnostics', scannedAt: new Date(NOW).toISOString(), rowsRead: 1, parsedRecords: 1, emittedRecords: 1, invalidRecords: 0, limited: 0 };
const notification = { type: 'notification', id: 'synthetic-1', title: '虚构测试群', body: '纯合成消息', timestamp: new Date(NOW).toISOString() };
const send = (child, event) => child.stdout.write(`${JSON.stringify(event)}\n`);
function fixture(t, output, overrides = {}) {
  let config = { ...DEFAULT_CONFIG, enabled: true, allowAll: true }, calls = 0, child;
  const store = new NotificationStore({ memory: true, config: () => config, now: () => NOW });
  const collector = new NotificationCollector({ store, config: () => config, helperPath: process.execPath,
    platform: 'darwin', startupTimeoutMs: 250, configPollMs: 10, now: () => NOW,
    spawn: () => {
      calls++; child = new EventEmitter(); child.stdout = new PassThrough(); child.exitCode = null;
      child.kill = () => { child.exitCode = 0; child.emit('exit', 0); return true; };
      setImmediate(() => output?.(child)); return child;
    }, ...overrides });
  t.after(() => { collector.stop(); store.close(); });
  return { store, collector, set: value => { config = value; }, get child() { return child; }, get calls() { return calls; } };
}

test('start waits for first full scan, saves events, reports safe counters', async t => {
  let beforeScan;
  const f = fixture(t, child => { send(child, ready); beforeScan = f.collector.status(); send(child, notification); send(child, diagnostics); });
  const result = await f.collector.start();
  assert.equal(beforeScan.status, 'starting'); assert.equal(beforeScan.lastScanAt, null);
  assert.equal(result.status, 'listening'); assert.equal(result.lastScanAt, diagnostics.scannedAt);
  assert.equal(result.counts.inserted, 1); assert.equal(f.store.recent().messages.length, 1);
  assert.ok(!JSON.stringify(result).includes(notification.body)); assert.ok(!JSON.stringify(result).includes(notification.title));
});

test('retryable database failures recover in the same helper and remain revocable', async t => {
  for (const reason of ['database_missing', 'database_busy', 'database_read_failed']) {
    const f = fixture(t, child => send(child, { type: 'status', status: 'error', reason }));
    const result = await f.collector.start();
    assert.equal(result.status, 'retrying'); assert.equal(result.reason, reason); assert.equal(result.lastScanAt, null);
    assert.equal(f.child.exitCode, null);
    assert.equal((await f.collector.start()).status, 'retrying'); assert.equal(f.calls, 1);
    send(f.child, ready);
    assert.equal(f.collector.status().status, 'starting', 'recovery is not fresh before diagnostics');
    send(f.child, notification); send(f.child, diagnostics);
    assert.equal(f.collector.status().status, 'listening'); assert.equal(f.collector.status().error, null);
    assert.equal(f.store.recent().messages.length, 1);
    send(f.child, { type: 'status', status: 'error', reason });
    assert.equal(f.collector.status().status, 'retrying', 'a past scan does not mask a current failure');
    f.set({ ...DEFAULT_CONFIG });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(f.child.exitCode, 0, 'revocation watcher survives recoverable failures');
    assert.equal(f.collector.status().reason, 'DISABLED');
    assert.throws(() => f.store.recent(), { code: 'DISABLED' });
  }
});

test('unsupported schemas are fatal and stop the helper', async t => {
  const f = fixture(t, child => send(child, { type: 'status', status: 'error', reason: 'schema_unsupported' }));
  const result = await f.collector.start();
  assert.equal(result.status, 'error'); assert.equal(result.reason, 'schema_unsupported'); assert.equal(f.child.exitCode, 0);
});

test('disabled, demo, unsupported and missing helper paths never start the reader', async t => {
  for (const mode of ['disabled', 'demo', 'unsupported', 'missing']) {
    const f = fixture(t, null, mode === 'demo' ? { demo: true } : mode === 'unsupported' ? { platform: 'linux' } : mode === 'missing' ? { helperPath: '/nonexistent/synthetic-reader' } : {});
    if (mode === 'disabled') f.set({ ...DEFAULT_CONFIG });
    const status = await f.collector.start();
    assert.notEqual(status.status, 'listening'); assert.equal(f.calls, 0);
  }
});

test('permission errors and incomplete startup do not report success', async t => {
  const denied = fixture(t, child => send(child, { type: 'status', status: 'blocked', reason: 'full_disk_access' }));
  assert.equal((await denied.collector.start()).permission, 'required');
  assert.equal(denied.collector.status().reason, 'full_disk_access');
  const hanging = fixture(t, child => send(child, ready));
  assert.equal((await hanging.collector.start()).reason, 'STARTUP_TIMEOUT');
});

test('config revocation immediately blocks another event and all reads', async t => {
  const f = fixture(t, child => { send(child, ready); send(child, diagnostics); }); await f.collector.start();
  f.set({ ...DEFAULT_CONFIG }); send(f.child, notification);
  assert.equal(f.collector.status().reason, 'DISABLED');
  assert.throws(() => f.store.recent(), { code: 'DISABLED' });
  f.set({ ...DEFAULT_CONFIG, enabled: true, allowAll: true });
  assert.equal(f.store.recent().messages.length, 0);
});

test('changed title scope is enforced before ingestion without restarting', async t => {
  const f = fixture(t, child => { send(child, ready); send(child, diagnostics); }); await f.collector.start();
  f.set({ ...DEFAULT_CONFIG, enabled: true, allowedTitles: ['另外的虚构群'] }); send(f.child, notification);
  assert.equal(f.collector.status().counts.ignored, 1); assert.equal(f.store.recent().messages.length, 0);
});

test('only newly stored notifications advance the last notification observation time', async t => {
  let now = NOW;
  const f = fixture(t, child => { send(child, ready); send(child, diagnostics); }, { now: () => now });
  await f.collector.start();
  assert.equal(f.collector.status().lastNotificationAt, null);
  send(f.child, notification);
  assert.equal(f.collector.status().lastNotificationAt, new Date(NOW).toISOString());
  now += 30000;
  send(f.child, notification);
  assert.equal(f.collector.status().counts.duplicates, 1);
  assert.equal(f.collector.status().lastNotificationAt, new Date(NOW).toISOString(), 'native retry is not a new observation');
  f.set({ ...DEFAULT_CONFIG, enabled: true, allowedTitles: ['另外的虚构群'] });
  now += 30000;
  send(f.child, { ...notification, id: 'synthetic-ignored' });
  assert.equal(f.collector.status().counts.ignored, 1);
  assert.equal(f.collector.status().lastNotificationAt, new Date(NOW).toISOString(), 'out-of-scope notifications do not count as stored observations');
  send(f.child, { ...notification, id: 'synthetic-new', title: '另外的虚构群' });
  assert.equal(f.collector.status().lastNotificationAt, new Date(now).toISOString());
});

test('malformed output, oversized unbroken lines and premature notifications fail closed', async t => {
  for (const output of [child => child.stdout.write('not json\n'), child => child.stdout.write('x'.repeat(64001)), child => send(child, notification)]) {
    const f = fixture(t, output); const result = await f.collector.start(); assert.equal(result.status, 'error');
    assert.equal(f.store.recent().messages.length, 0);
  }
});

test('utf8 chunks and repeated notification IDs preserve one message', async t => {
  const f = fixture(t, child => {
    send(child, ready);
    const bytes = Buffer.from(`${JSON.stringify(notification)}\n`);
    for (let i = 0; i < bytes.length; i += 7) child.stdout.write(bytes.subarray(i, i + 7));
    send(child, notification); send(child, diagnostics);
  });
  const result = await f.collector.start(); assert.equal(result.counts.inserted, 1); assert.equal(result.counts.duplicates, 1);
  assert.equal(f.store.recent().messages[0].text, notification.body);
});

test('invalid diagnostics and storage errors never claim a fresh scan', async t => {
  const bad = fixture(t, child => { send(child, ready); send(child, { ...diagnostics, rowsRead: -1 }); });
  assert.equal((await bad.collector.start()).reason, 'INVALID_DIAGNOSTICS');
  const failed = fixture(t, child => { send(child, ready); send(child, notification); send(child, diagnostics); }, { store: { ingest() { throw new Error('synthetic failure'); } } });
  const result = await failed.collector.start(); assert.equal(result.reason, 'STORAGE_FAILED'); assert.equal(result.lastScanAt, null);
});

test('native source is identical to Orbit reader and reads no WeChat database', () => {
  const plugin = readFileSync(new URL('../native/wechat-notification-db.swift', import.meta.url), 'utf8');
  const originalPath = new URL('../../../scripts/native/wechat-notification-db.swift', import.meta.url);
  if (existsSync(originalPath)) assert.equal(plugin, readFileSync(originalPath, 'utf8'));
  // Standalone plugin archives need not carry the entire Orbit source tree.
  assert.equal(createHash('sha256').update(plugin).digest('hex'), '4fe27b402c6983766ce206d2b974c5df0ad6b4d98b40524f30474c5813faf274');
  assert.ok(plugin.includes('SQLITE_OPEN_READONLY')); assert.ok(plugin.includes('group.com.apple.usernoted/db2/db'));
});
