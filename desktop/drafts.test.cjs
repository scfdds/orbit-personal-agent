const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, stat, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DraftStore, MAX_BYTES } = require('./drafts.cjs');

test('drafts persist across process instances with whitelist references and private file permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-drafts-'));
  try {
    const store = new DraftStore(directory);
    await Promise.all([
      store.write('home', { text: '主对话草稿', reference: null }),
      store.write('thread:123', { text: '继续这件事', reference: { conversationId: '123', quote: '原文', command: 'not allowed' } }),
    ]);
    const restarted = new DraftStore(directory);
    assert.deepEqual(await restarted.read(), {
      home: { text: '主对话草稿', reference: null },
      'thread:123': { text: '继续这件事', reference: { conversationId: '123', quote: '原文' } },
    });
    assert.equal((await stat(join(directory, 'drafts.json'))).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(directory), ['drafts.json']);
    await restarted.write('home', { text: '', reference: null });
    assert.equal((await restarted.read()).home, undefined);
    await assert.rejects(restarted.write('__proto__', { text: 'bad', reference: null }));
    await assert.rejects(restarted.write('huge', { text: 'x'.repeat(40001), reference: null }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('draft count and serialized bytes remain bounded while retaining the newest write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-drafts-'));
  try {
    const store = new DraftStore(directory);
    for (let i = 0; i < 102; i++) await store.write('small-' + i, { text: 'x', reference: null });
    let data = await store.read();
    assert.equal(Object.keys(data).length, 100);
    assert.equal(data['small-0'], undefined);
    for (let i = 0; i < 20; i++) await store.write('large-' + i, { text: '文'.repeat(40000), reference: null });
    data = await store.read();
    assert.ok((await stat(join(directory, 'drafts.json'))).size <= MAX_BYTES);
    assert.equal(data['large-19'].text.length, 40000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
