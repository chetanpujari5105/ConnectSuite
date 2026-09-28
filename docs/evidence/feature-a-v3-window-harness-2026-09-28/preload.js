const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('connect', {
  shareWindowState: () => ipcRenderer.invoke('share-window-state'),
  onShareWindow: (cb) => ipcRenderer.on('share-window', (_e, s) => cb(s)),
  shareWindowClose: () => ipcRenderer.send('share-window-close'),
  shareWindowHeight: (h) => ipcRenderer.send('share-window-height', h),
  shareDecide: (offerId, decision) => ipcRenderer.invoke('share-decide', { offerId, decision }),
  shareAct: (action, offerId) => ipcRenderer.invoke(`share-${action}`, { offerId }),
});
contextBridge.exposeInMainWorld('__harness', {
  push: (p) => ipcRenderer.send('h-push', p),
  calls: () => ipcRenderer.invoke('h-calls'),
  facts: () => ipcRenderer.invoke('h-facts'),
});
