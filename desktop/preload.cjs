const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbitDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  hideQuick: () => ipcRenderer.invoke('orbit:hide-quick'),
  resizeQuick: (height) => ipcRenderer.invoke('orbit:resize-quick', height),
  openMain: (target = {}) => ipcRenderer.invoke('orbit:open-main', target),
  getInfo: () => ipcRenderer.invoke('orbit:get-info'),
  openAccessibilitySettings: () => ipcRenderer.invoke('orbit:open-accessibility-settings'),
  openFullDiskAccessSettings: () => ipcRenderer.invoke('orbit:open-full-disk-access-settings'),
  revealApplication: () => ipcRenderer.invoke('orbit:reveal-application'),
  requestMicrophonePermission: () => ipcRenderer.invoke('orbit:request-microphone'),
  readDrafts: () => ipcRenderer.invoke('orbit:read-drafts'),
  writeDraft: (id, draft) => ipcRenderer.invoke('orbit:write-draft', id, draft),
  readPreferences: () => ipcRenderer.invoke('orbit:read-preferences'),
  writePreferences: value => ipcRenderer.invoke('orbit:write-preferences', value),
  onPreferencesChanged: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('orbit:preferences-changed', listener);
    return () => ipcRenderer.removeListener('orbit:preferences-changed', listener);
  },
  onSurfaceHidden: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('orbit:surface-hidden', listener);
    return () => ipcRenderer.removeListener('orbit:surface-hidden', listener);
  },
  onNavigate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, target) => callback(target);
    ipcRenderer.on('orbit:navigate', listener);
    ipcRenderer.send('orbit:renderer-ready');
    return () => ipcRenderer.removeListener('orbit:navigate', listener);
  },
}));
