const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('livechat', {
  // Overlay
  onPop: (fn) => ipcRenderer.on('overlay:pop', (_e, p) => fn(p)),
  onClear: (fn) => ipcRenderer.on('overlay:clear', () => fn()),
  onOverlaySettings: (fn) => ipcRenderer.on('overlay:settings', (_e, s) => fn(s)),
  busy: () => ipcRenderer.send('overlay:busy'),
  idle: () => ipcRenderer.send('overlay:idle'),

  // Paramètres
  getState: () => ipcRenderer.invoke('settings:get'),
  save: (patch) => ipcRenderer.invoke('settings:save', patch),
  test: () => ipcRenderer.invoke('settings:test'),
  identify: () => ipcRenderer.invoke('settings:identify'),
  pauseHotkeys: () => ipcRenderer.send('settings:hotkeys-pause'),
  resumeHotkeys: () => ipcRenderer.send('settings:hotkeys-resume'),
  onStatus: (fn) => ipcRenderer.on('settings:status', (_e, s) => fn(s)),
  onState: (fn) => ipcRenderer.on('settings:state', (_e, s) => fn(s)),
});
