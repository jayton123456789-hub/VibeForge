const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashBridge', {
  checkFirstRun: () => ipcRenderer.invoke('splash-check-first-run'),
  onSetupStep: (cb) => ipcRenderer.on('setup-step', (_e, data) => cb(data)),
  onSetupDone: (cb) => ipcRenderer.on('setup-done', (_e, data) => cb(data)),
  runSetup: () => ipcRenderer.invoke('splash-run-setup'),
  skipSetup: () => ipcRenderer.invoke('splash-skip-setup'),
});
