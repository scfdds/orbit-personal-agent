import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, loadConfig, saveConfig, validateConfig } from '../src/config.mjs';
import { NotificationStore } from '../src/store.mjs';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const enabled = () => ({ ...DEFAULT_CONFIG, enabled: true, allowAll: true });
const event = (id = '1', title = '虚构测试群', age = 0) => ({ id, title, body: `合成测试消息 ${id}`, timestamp: new Date(NOW - age).toISOString() });
function fixture(t, initial = enabled()) {
  let settings = initial;
  const store = new NotificationStore({ memory: true, config: () => settings, now: () => NOW });
  t.after(() => store.close());
  return { store, set: value => { settings = value; } };
}

test('config is opt-in, validates strictly, saves private files and reloads', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wechat-plugin-config-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(loadConfig(dir).enabled, false);
  const settings = saveConfig(dir, { enabled: true, allowedTitles: [' 合成群 ', '合成群'] });
  assert.deepEqual(settings.allowedTitles, ['合成群']);
  assert.equal(loadConfig(dir).enabled, true);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, 'config.json')).mode & 0o777, 0o600);
  for (const patch of [{ enabled: 'yes' }, { allowAll: 1 }, { retentionDays: 0 }, { retentionDays: 91 }, { allowedTitles: [''] }, { unknown: true }]) {
    assert.throws(() => saveConfig(dir, patch), { code: 'INVALID_CONFIG' });
  }
  writeFileSync(join(dir, 'config.json'), '{');
  assert.throws(() => loadConfig(dir), { code: 'INVALID_CONFIG' });
});

test('config rejects symbolic-link configuration files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wechat-plugin-link-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'other.json'), JSON.stringify(DEFAULT_CONFIG));
  symlinkSync(join(dir, 'other.json'), join(dir, 'config.json'));
  assert.throws(() => loadConfig(dir), { code: 'INVALID_DATA_FILE' });
});

test('ingest is validated, authorized, deduplicated and bounded by retention', t => {
  const { store } = fixture(t, { ...enabled(), allowAll: false, allowedTitles: ['虚构测试群'] });
  assert.deepEqual(store.ingest([event('1'), event('2', '不允许的合成群'), event('old', '虚构测试群', 8 * 86400000)]), { inserted: 1, duplicates: 0, ignored: 2 });
  assert.equal(store.ingest(event('1')).duplicates, 1);
  assert.equal(store.listSources().sources.length, 1);
  assert.throws(() => store.ingest([event('3'), { ...event('4'), timestamp: 'bad' }]), { code: 'INVALID_NOTIFICATION' });
  assert.equal(store.recent().messages.length, 1, 'whole batch validates before mutation');
  assert.throws(() => store.ingest({ ...event(), timestamp: new Date(NOW + 360000).toISOString() }), { code: 'INVALID_NOTIFICATION' });
  assert.throws(() => store.ingest({ ...event(), body: 'x'.repeat(10001) }), { code: 'INVALID_NOTIFICATION' });
});

test('all reads and writes re-check authorization and never return revoked titles', t => {
  const { store, set } = fixture(t);
  store.ingest([event('1', '合成甲'), event('2', '合成乙')]);
  const all = store.listSources().sources;
  const revoked = all.find(source => source.title === '合成乙').id;
  set({ ...enabled(), allowAll: false, allowedTitles: ['合成甲'] });
  assert.deepEqual(store.listSources().sources.map(source => source.title), ['合成甲']);
  assert.equal(store.search({ query: '合成' }).messages.length, 1);
  assert.throws(() => store.read({ sourceId: revoked }), { code: 'SOURCE_NOT_ALLOWED' });
  set({ ...enabled(), enabled: false });
  for (const read of [() => store.listSources(), () => store.recent(), () => store.search({ query: '合成' }), () => store.read({ sourceId: revoked }), () => store.ingest(event())]) {
    assert.throws(read, { code: 'DISABLED' });
  }
  assert.equal(store.clear().removed, 2, 'deletion remains possible while disabled');
});

test('pagination is stable for equal timestamps and bound to query and scope', t => {
  const { store, set } = fixture(t);
  store.ingest(Array.from({ length: 7 }, (_, i) => event(String(i))));
  let cursor, ids = [];
  do {
    const page = store.recent({ limit: 2, before: cursor }); ids.push(...page.messages.map(message => message.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(ids).size, 7);
  const page = store.recent({ limit: 2 });
  assert.throws(() => store.search({ query: '测试', before: page.nextCursor }), { code: 'INVALID_CURSOR' });
  set({ ...enabled(), allowAll: false, allowedTitles: ['虚构测试群'] });
  assert.throws(() => store.recent({ before: page.nextCursor }), { code: 'INVALID_CURSOR' });
});

test('search and time filters are literal and limits are validated', t => {
  const { store } = fixture(t);
  store.ingest([{ ...event('1'), body: '进度 50% _ 测试' }, event('2', '虚构测试群', 60000)]);
  assert.equal(store.search({ query: '%' }).messages.length, 1);
  assert.equal(store.search({ query: "' OR 1=1 --" }).messages.length, 0);
  assert.equal(store.recent({ since: new Date(NOW - 1000).toISOString() }).messages.length, 1);
  for (const limit of [0, -1, 1.5, 101, '20']) assert.throws(() => store.recent({ limit }), { code: 'INVALID_LIMIT' });
  assert.throws(() => store.recent({ since: 'yesterday' }), { code: 'INVALID_TIME' });
  assert.throws(() => store.read(), { code: 'INVALID_SOURCE' });
});

test('retention changes prune existing rows and storage caps at 10000', t => {
  const { store, set } = fixture(t);
  store.ingest(event('old', '虚构测试群', 2 * 86400000));
  set({ ...enabled(), retentionDays: 1 });
  assert.equal(store.recent().messages.length, 0);
  for (let batch = 0; batch < 11; batch++) store.ingest(Array.from({ length: 1000 }, (_, i) => event(`${batch}-${i}`)));
  assert.equal(store.listSources().sources[0].messageCount, 10000);
});

test('disk stores persist privately; memory stores perform no disk writes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'wechat-plugin-store-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  saveConfig(dir, { enabled: true, allowAll: true });
  const first = new NotificationStore({ dataDir: dir, now: () => NOW }); first.ingest(event()); first.close();
  assert.equal(statSync(join(dir, 'notifications.sqlite')).mode & 0o777, 0o600);
  const second = new NotificationStore({ dataDir: dir, now: () => NOW });
  assert.equal(second.recent().messages.length, 1); second.close();
  const memory = new NotificationStore({ dataDir: null, config: enabled, now: () => NOW }); memory.ingest(event()); memory.close();
  assert.throws(() => memory.recent(), { code: 'CLOSED' });
  assert.ok(readFileSync(join(dir, 'config.json'), 'utf8').includes('enabled'));
});

test('default object cannot be used to silently allow all', () => {
  assert.deepEqual(validateConfig({}).allowedTitles, []);
  assert.equal(validateConfig({ enabled: true }).allowAll, false);
});
