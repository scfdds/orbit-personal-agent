const { app, BrowserWindow, Menu, globalShortcut, ipcMain, session, net, utilityProcess, shell, dialog, screen, nativeTheme, systemPreferences } = require('electron');
const { join, resolve } = require('node:path');
const { mkdirSync, appendFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { sameOrigin, externalUrl, navigationTarget } = require('./security.cjs');
const { DraftStore } = require('./drafts.cjs');
const { PreferenceStore } = require('./preferences.cjs');
const { audioRequestAllowed, audioCheckAllowed } = require('./audio-permissions.cjs');

app.setName('Orbit');
if (process.env.ORBIT_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.ORBIT_DESKTOP_USER_DATA));
const drafts = new DraftStore(app.getPath('userData'));
const preferences = new PreferenceStore(app.getPath('userData'));
const shortcut = 'Alt+Space';
let mainWindow, quickWindow, backend, origin;
let quitting = false, shutdownComplete = false, shortcutRegistered = false;
let pendingNavigation = null;
const readyRenderers = new Set();
const microphoneRenderers = new Set();
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  console.log(message);
  try { appendFileSync(join(app.getPath('userData'), 'desktop.log'), line); } catch {}
}
function trusted(event, quickOnly = false) {
  const allowed = quickOnly ? [quickWindow] : [mainWindow, quickWindow];
  return allowed.some(win => win && !win.isDestroyed() && win.webContents === event.sender)
    && event.senderFrame === event.sender.mainFrame && sameOrigin(event.senderFrame.url, origin);
}
function ensureSender(event, quickOnly = false) {
  if (!trusted(event, quickOnly)) throw new Error('This window cannot perform that action');
}
function trustedMediaContents(contents) {
  return !!contents && [mainWindow, quickWindow].some(win => win && !win.isDestroyed() && win.webContents === contents)
    && sameOrigin(contents.getURL(), origin) && microphoneRenderers.has(contents.id);
}
function sendNavigation() {
  if (mainWindow && !mainWindow.isDestroyed() && pendingNavigation && readyRenderers.has(mainWindow.webContents.id)) {
    mainWindow.webContents.send('orbit:navigate', pendingNavigation);
    pendingNavigation = null;
  }
}
function hideWindow(win) {
  if (!win || win.isDestroyed()) return;
  // Notify before hide(): macOS can report an already-occluded window as hidden
  // and omit its hide event while the renderer's media context is still active.
  if (!win.webContents.isDestroyed()) win.webContents.send('orbit:surface-hidden');
  win.hide();
}
function revealMain(target) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (target) pendingNavigation = navigationTarget(target);
  hideWindow(quickWindow);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
  sendNavigation();
}
async function revealQuick() {
  if (!quickWindow || quickWindow.isDestroyed()) return;
  // A preloaded quick renderer must not expose real conversations during a demo.
  try {
    const response = await net.fetch(origin + '/api/workspace-mode', { signal: AbortSignal.timeout(1500) });
    const mode = response.ok ? await response.json() : null;
    if (mode?.demo !== false) { pendingNavigation = null; revealMain(); return; }
  } catch { pendingNavigation = null; revealMain(); return; }
  if (!quickWindow || quickWindow.isDestroyed()) return;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [width, height] = quickWindow.getSize();
  quickWindow.setPosition(Math.round(workArea.x + (workArea.width - width) / 2), Math.round(workArea.y + Math.max(35, (workArea.height - height) * .32)));
  quickWindow.show(); quickWindow.focus();
}
function safeExternal(url) {
  const safe = externalUrl(url);
  if (safe) void shell.openExternal(safe).catch(() => {});
}
function secureWindow(win) {
  // macOS can leave document.hidden false for a hidden Electron window.
  // Send an explicit lifecycle signal so the renderer never keeps its microphone
  // or narration alive after the user closes/hides a surface.
  win.on('hide', () => { if (!win.webContents.isDestroyed()) win.webContents.send('orbit:surface-hidden'); });
  win.on('minimize', () => { if (!win.webContents.isDestroyed()) win.webContents.send('orbit:surface-hidden'); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (!sameOrigin(url, origin)) safeExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url, origin)) { event.preventDefault(); safeExternal(url); }
  });
  win.webContents.on('will-redirect', (event, url) => { if (!sameOrigin(url, origin)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('did-start-loading', () => { readyRenderers.delete(win.webContents.id); microphoneRenderers.delete(win.webContents.id); });
  win.on('close', event => { if (!quitting) { event.preventDefault(); hideWindow(win); } });
}
function createWindows() {
  const mac = process.platform === 'darwin';
  const preferences = { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false };
  mainWindow = new BrowserWindow({
    width: 1160, height: 820, minWidth: 780, minHeight: 580, show: false, title: 'Orbit',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202228' : '#ffffff',
    ...(mac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 17, y: 20 }, vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    webPreferences: preferences,
  });
  quickWindow = new BrowserWindow({
    width: 620, height: 360, minWidth: 460, maxWidth: 780, minHeight: 180, maxHeight: 680,
    show: false, title: 'Orbit · 快速对话', frame: false, resizable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#242832' : '#f5f7fa',
    ...(mac ? { vibrancy: 'popover', visualEffectState: 'active', roundedCorners: true } : {}),
    webPreferences: preferences,
  });
  secureWindow(mainWindow); secureWindow(quickWindow);
  quickWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && !input.isComposing) { event.preventDefault(); hideWindow(quickWindow); }
  });
  mainWindow.once('ready-to-show', () => { if (!process.env.ORBIT_DESKTOP_TEST_HIDE) revealMain(); });
  void mainWindow.loadURL(origin + '/?surface=main');
  void quickWindow.loadURL(origin + '/?surface=quick');
}
function setMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ label: 'Orbit', submenu: [
      { role: 'about', label: '关于 Orbit' }, { type: 'separator' },
      { label: '设置…', accelerator: 'Command+,', click: () => revealMain({ view: 'settings' }) },
      { type: 'separator' }, { label: '隐藏 Orbit', accelerator: 'Command+H', click: () => { hideWindow(mainWindow); hideWindow(quickWindow); app.hide(); } }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '显示全部' },
      { type: 'separator' }, { role: 'quit', label: '退出 Orbit' },
    ] }] : []),
    { label: '文件', submenu: [
      { label: '主对话', accelerator: 'CmdOrCtrl+1', click: () => revealMain({ view: 'home' }) },
      { label: '唤起助手', accelerator: shortcutRegistered ? undefined : 'CmdOrCtrl+Shift+Space', click: revealQuick },
      { label: '收起窗口', accelerator: 'CmdOrCtrl+W', click: () => hideWindow(BrowserWindow.getFocusedWindow()) },
      ...(!mac ? [{ type: 'separator' }, { role: 'quit', label: '退出 Orbit' }] : []),
    ] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '显示', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }, ...(!app.isPackaged ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }] : [])] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { label: '打开 Orbit', click: () => revealMain() }, ...(mac ? [{ role: 'front', label: '前置全部窗口' }] : [])] },
  ]));
  app.setAboutPanelOptions({ applicationName: 'Orbit', applicationVersion: app.getVersion(), copyright: '个人 Agent 工作空间' });
}
function startBackend() {
  const token = randomBytes(32).toString('hex');
  const userData = app.getPath('userData');
  mkdirSync(join(userData, 'data'), { recursive: true, mode: 0o700 });
  const env = { ...process.env, ORBIT_DESKTOP: '1', ORBIT_PORT: '0', ORBIT_AUTH_TOKEN: token,
    ORBIT_DATA_DIR: process.env.ORBIT_DATA_DIR || join(userData, 'data'),
    ORBIT_CONFIG_PATH: process.env.ORBIT_CONFIG_PATH || join(userData, 'model-config.json'),
    ORBIT_MCP_CONFIG: process.env.ORBIT_MCP_CONFIG || join(userData, 'mcp.local.json'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  backend = utilityProcess.fork(join(__dirname, 'backend.mjs'), [], { cwd: app.getAppPath(), env, stdio: 'pipe', serviceName: 'Orbit Agent' });
  // Drain output. Backend logs may include model/provider details; do not copy them to UI or desktop logs.
  backend.stdout?.on('data', () => {}); backend.stderr?.on('data', () => {});
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('本地 Agent 服务启动超时')), 30000);
    backend.on('message', message => {
      if (message?.type === 'ready' && Number.isInteger(message.port) && message.port > 0 && message.port < 65536) {
        clearTimeout(timer); origin = `http://127.0.0.1:${message.port}`;
        const ses = session.defaultSession;
        ses.setPermissionRequestHandler((contents, permission, callback, details) => {
          callback(trustedMediaContents(contents) && audioRequestAllowed(permission, details, origin));
        });
        ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
          return trustedMediaContents(contents) && audioCheckAllowed(permission, requestingOrigin, details, origin);
        });
        ses.webRequest.onBeforeSendHeaders((details, callback) => {
          const requestHeaders = { ...details.requestHeaders };
          // Remove a renderer-supplied header, then inject only for our own service.
          for (const name of Object.keys(requestHeaders)) if (name.toLowerCase() === 'x-orbit-token') delete requestHeaders[name];
          if (sameOrigin(details.url, origin)) requestHeaders['X-Orbit-Token'] = token;
          callback({ requestHeaders });
        });
        ses.webRequest.onHeadersReceived({ urls: [origin + '/*'] }, (details, callback) => callback({ responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"],
        } }));
        log(`Agent ready (Node ${message.nodeVersion}; port ${message.port})`); resolveReady();
      } else if (message?.type === 'error') { clearTimeout(timer); reject(new Error(message.message || '本地 Agent 服务启动失败')); }
    });
    backend.on('exit', code => {
      clearTimeout(timer);
      if (!origin) reject(new Error(`本地 Agent 服务退出 (${code})`));
      else if (!quitting) {
        log(`Agent exited unexpectedly (${code})`);
        void dialog.showMessageBox({ type: 'error', title: 'Orbit', message: '本地 Agent 服务已停止', detail: '请退出并重新打开 Orbit。已保存的对话不会丢失。', buttons: ['退出 Orbit'] }).then(() => app.quit());
      }
    });
  });
}
async function stopBackend() {
  if (!backend || backend.pid === undefined) return;
  await new Promise(resolveStop => {
    const timeout = setTimeout(() => { backend?.kill(); resolveStop(); }, 4500);
    backend.once('exit', () => { clearTimeout(timeout); resolveStop(); });
    backend.postMessage({ type: 'shutdown' });
  });
}
if (ownsInstance) {
  process.once('SIGINT', () => app.quit());
  process.once('SIGTERM', () => app.quit());
  app.on('second-instance', () => revealMain());
  app.on('activate', () => revealMain());
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true; globalShortcut.unregisterAll();
    hideWindow(mainWindow); hideWindow(quickWindow);
    void Promise.all([stopBackend(), drafts.flush(), preferences.flush()]).finally(() => { shutdownComplete = true; app.quit(); });
  });
  ipcMain.handle('orbit:hide-quick', event => { ensureSender(event, true); hideWindow(quickWindow); });
  ipcMain.handle('orbit:resize-quick', (event, height) => {
    ensureSender(event, true);
    if (!Number.isFinite(height)) return;
    const max = Math.min(680, screen.getDisplayMatching(quickWindow.getBounds()).workArea.height - 60);
    quickWindow.setSize(quickWindow.getSize()[0], Math.max(180, Math.min(max, Math.ceil(height))));
  });
  ipcMain.handle('orbit:open-main', (event, target) => { ensureSender(event); revealMain(navigationTarget(target)); });
  ipcMain.handle('orbit:get-info', event => { ensureSender(event); return { version: app.getVersion(), platform: process.platform, shortcut, shortcutRegistered }; });
  // Fixed destinations only. Opening Settings never grants system permissions.
  ipcMain.handle('orbit:open-accessibility-settings', async event => {
    ensureSender(event);
    if (process.platform !== 'darwin') return;
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });
  ipcMain.handle('orbit:open-full-disk-access-settings', async event => {
    ensureSender(event);
    if (process.platform !== 'darwin') return;
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
  });
  ipcMain.handle('orbit:reveal-application', event => {
    ensureSender(event);
    if (process.platform === 'darwin' && app.isPackaged) shell.showItemInFolder(resolve(process.execPath, '../../..'));
  });
  // The renderer invokes this from voice mode or an explicit quick-to-main voice
  // handoff. Never on startup/background navigation; no camera capability is granted.
  ipcMain.handle('orbit:request-microphone', async event => {
    ensureSender(event);
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status !== 'granted' && (status !== 'not-determined' || !await systemPreferences.askForMediaAccess('microphone'))) return false;
    }
    if (!trusted(event)) return false;
    microphoneRenderers.add(event.sender.id);
    return true;
  });
  ipcMain.handle('orbit:read-drafts', event => { ensureSender(event); return drafts.read(); });
  ipcMain.handle('orbit:write-draft', (event, id, draft) => { ensureSender(event); return drafts.write(id, draft); });
  ipcMain.handle('orbit:read-preferences', event => { ensureSender(event); return preferences.read(); });
  ipcMain.handle('orbit:write-preferences', async (event, value) => {
    ensureSender(event);
    const saved = await preferences.write(value);
    for (const window of [mainWindow, quickWindow]) if (window && !window.isDestroyed()) window.webContents.send('orbit:preferences-changed', saved);
    return saved;
  });
  ipcMain.on('orbit:renderer-ready', event => { if (!trusted(event)) return; readyRenderers.add(event.sender.id); sendNavigation(); });
  void app.whenReady().then(async () => {
    mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
    if (process.platform === 'darwin') app.dock?.setIcon(join(__dirname, 'assets', 'orbit-icon.png'));
    await startBackend();
    createWindows();
    shortcutRegistered = globalShortcut.register(shortcut, () => quickWindow?.isVisible() ? hideWindow(quickWindow) : revealQuick());
    if (!shortcutRegistered) log('Option+Space unavailable; use File > 唤起助手 or Command+Shift+Space.');
    setMenu();
    log(`Orbit desktop ready (${app.getVersion()}; Electron ${process.versions.electron})`);
    if (process.platform === 'darwin') log(`Orbit Accessibility permission: ${systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'not granted'}`);
  }).catch(async error => {
    log('Desktop startup failed.');
    if (process.env.ORBIT_DESKTOP_TEST_HIDE) console.error(error.message);
    else await dialog.showMessageBox({ type: 'error', title: 'Orbit 无法启动', message: String(error.message || '本地服务未能启动'), buttons: ['退出'] });
    app.quit();
  });
}
