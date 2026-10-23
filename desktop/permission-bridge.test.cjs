const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function mainBridge(platform = 'darwin') {
  const handlers = new Map(), opened = [];
  const electron = {
    app: {
      setName() {}, getPath() { return '/virtual/orbit'; }, requestSingleInstanceLock() { return true; },
      on() {}, whenReady() { return new Promise(() => {}); },
    },
    ipcMain: { handle(name, handler) { handlers.set(name, handler); }, on() {} },
    shell: { async openExternal(url) { opened.push(url); } },
  };
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return electron;
      if (name === './drafts.cjs') return { DraftStore: class {} };
      if (name === './preferences.cjs') return { PreferenceStore: class {} };
      return require(name);
    },
    process: { env: {}, platform, once() {} }, console, __dirname,
  });
  vm.runInContext(readFileSync(join(__dirname, 'main.cjs'), 'utf8'), context);
  const frame = { url: 'http://127.0.0.1:49311/' };
  const sender = { mainFrame: frame };
  context.testWindow = { isDestroyed() { return false; }, webContents: sender };
  vm.runInContext("mainWindow = testWindow; origin = 'http://127.0.0.1:49311';", context);
  return { handlers, opened, event: { sender, senderFrame: frame }, context };
}

test('Full Disk Access bridge opens only its fixed pane for the trusted main frame', async () => {
  const { handlers, opened, event } = mainBridge();
  const open = handlers.get('orbit:open-full-disk-access-settings');
  assert.equal(typeof open, 'function');
  await open(event, 'file:///private/data', { url: 'https://example.com' });
  assert.deepEqual(opened, ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles']);
  await assert.rejects(open({ sender: { mainFrame: event.senderFrame }, senderFrame: event.senderFrame }), /cannot perform/);
  await assert.rejects(open({ sender: event.sender, senderFrame: { url: event.senderFrame.url } }), /cannot perform/);
  event.senderFrame.url = 'https://example.com/';
  await assert.rejects(open(event), /cannot perform/);
  assert.equal(opened.length, 1);
});

test('system permission panes are inert outside macOS and keep the prior Accessibility entry', async () => {
  const linux = mainBridge('linux');
  await linux.handlers.get('orbit:open-full-disk-access-settings')(linux.event);
  assert.deepEqual(linux.opened, []);
  const mac = mainBridge();
  await mac.handlers.get('orbit:open-accessibility-settings')(mac.event);
  assert.deepEqual(mac.opened, ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility']);
});

test('preload exposes fixed permission actions without forwarding renderer-supplied destinations', async () => {
  let bridge;
  const calls = [];
  vm.runInNewContext(readFileSync(join(__dirname, 'preload.cjs'), 'utf8'), {
    process: { platform: 'darwin' },
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld(_name, value) { bridge = value; } }, ipcRenderer: { async invoke(...args) { calls.push(args); } } };
    },
  });
  assert.ok(Object.isFrozen(bridge));
  await bridge.openFullDiskAccessSettings('https://example.com', { command: 'other' });
  await bridge.openAccessibilitySettings();
  await bridge.revealApplication();
  assert.deepEqual(calls, [
    ['orbit:open-full-disk-access-settings'],
    ['orbit:open-accessibility-settings'],
    ['orbit:reveal-application'],
  ]);
});
