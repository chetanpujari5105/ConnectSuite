// A compromised page: raw access to ipcRenderer, i.e. everything a narrow preload would have hidden.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('raw', { invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args) });
