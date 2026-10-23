const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function quickHarness(fetchMode) {
  const calls = [];
  const electron = {
    app: {
      setName() {}, getPath() { return '/virtual/orbit'; }, requestSingleInstanceLock() { return false; }, quit() {},
    },
    net: { async fetch(url) { calls.push(['fetch', url]); return fetchMode(); } },
    screen: {
      getCursorScreenPoint() { return { x: 100, y: 100 }; },
      getDisplayNearestPoint() { return { workArea: { x: 0, y: 0, width: 1200, height: 900 } }; },
    },
  };
  const window = name => ({
    isDestroyed: () => false, isMinimized: () => false,
    show() { calls.push([name, 'show']); }, focus() { calls.push([name, 'focus']); }, hide() { calls.push([name, 'hide']); },
    getSize() { return [620, 360]; }, setPosition() {},
    webContents: { id: name, isDestroyed: () => false, send(...args) { calls.push([name, ...args]); } },
  });
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return electron;
      if (name === './drafts.cjs') return { DraftStore: class {} };
      if (name === './preferences.cjs') return { PreferenceStore: class {} };
      return require(name);
    },
    process: { env: {}, platform: 'darwin' }, console, __dirname, AbortSignal,
    testMain: window('main'), testQuick: window('quick'),
  });
  vm.runInContext(readFileSync(join(__dirname, 'main.cjs'), 'utf8'), context);
  vm.runInContext("mainWindow = testMain; quickWindow = testQuick; origin = 'http://127.0.0.1:49311'; pendingNavigation = { conversationId: 'private-old-target' }; readyRenderers.add('main');", context);
  return { calls, reveal: () => vm.runInContext('revealQuick()', context) };
}

test('global demo shortcut opens the main workspace and drops a stale real navigation', async () => {
  const h = quickHarness(() => ({ ok: true, json: async () => ({ demo: true, revision: 'demo-revision' }) }));
  await h.reveal();
  assert.deepEqual(h.calls[0], ['fetch', 'http://127.0.0.1:49311/api/workspace-mode']);
  assert.ok(h.calls.some(call => call[0] === 'main' && call[1] === 'show'));
  assert.ok(!h.calls.some(call => call[0] === 'quick' && call[1] === 'show'));
  assert.ok(!h.calls.some(call => call[1] === 'orbit:navigate'));
});

test('the quick window is shown only after an explicit real-workspace response', async () => {
  const h = quickHarness(() => ({ ok: true, json: async () => ({ demo: false, revision: 'real-revision' }) }));
  await h.reveal();
  assert.ok(h.calls.some(call => call[0] === 'quick' && call[1] === 'show'));
  assert.ok(!h.calls.some(call => call[0] === 'main' && call[1] === 'show'));
});

test('unavailable or malformed mode information never reveals a cached quick conversation', async () => {
  for (const response of [
    () => ({ ok: false }),
    () => ({ ok: true, json: async () => ({ state: { active: false } }) }),
    () => { throw new Error('service unavailable'); },
  ]) {
    const h = quickHarness(response);
    await h.reveal();
    assert.ok(h.calls.some(call => call[0] === 'main' && call[1] === 'show'));
    assert.ok(!h.calls.some(call => call[0] === 'quick' && call[1] === 'show'));
    assert.ok(!h.calls.some(call => call[1] === 'orbit:navigate'));
  }
});
