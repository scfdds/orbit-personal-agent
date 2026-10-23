const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, readFile, stat } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { PreferenceStore } = require('./preferences.cjs');

test('spoken delivery preference survives a native restart and broadcasts only its narrow data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-preferences-'));
  try {
    const store = new PreferenceStore(directory);
    assert.deepEqual(await store.read(), { spokenDelivery: true });
    await store.write({ spokenDelivery: false });
    const nextProcess = new PreferenceStore(directory);
    assert.deepEqual(await nextProcess.read(), { spokenDelivery: false });
    assert.equal((await stat(join(directory, 'preferences.json'))).mode & 0o777, 0o600);
    await assert.rejects(store.write({ spokenDelivery: true, path: '/tmp/elsewhere' }));
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'preferences.json'), 'utf8')), { spokenDelivery: false });
    await Promise.all([store.write({ spokenDelivery: true }), store.write({ spokenDelivery: false })]);
    await store.flush();
    assert.deepEqual(await store.read(), { spokenDelivery: false });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('navigation preferences survive port-changing restarts and partial voice writes preserve them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-navigation-preferences-'));
  try {
    const store = new PreferenceStore(directory);
    await store.write({ sidebarCollapsed: false, recentMatterIds: ['learning', 'website'] });
    await store.write({ spokenDelivery: false });
    const expected = { spokenDelivery: false, sidebarCollapsed: false, recentMatterIds: ['learning', 'website'] };
    assert.deepEqual(await new PreferenceStore(directory).read(), expected);
    await Promise.all([store.write({ sidebarCollapsed: true }), store.write({ recentMatterIds: ['learning', 'website', 'travel'] })]);
    assert.deepEqual(await store.read(), { ...expected, sidebarCollapsed: true, recentMatterIds: ['learning', 'website', 'travel'] });
    for (const invalid of [{ sidebarCollapsed: 'false' }, { recentMatterIds: [42] }, { recentMatterIds: Array.from({ length: 8 }, (_, index) => String(index)) }, { configPath: '/private' }, {}])
      await assert.rejects(store.write(invalid));
    assert.deepEqual(await new PreferenceStore(directory).read(), { ...expected, sidebarCollapsed: true, recentMatterIds: ['learning', 'website', 'travel'] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
