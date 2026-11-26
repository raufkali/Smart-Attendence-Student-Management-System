const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronDesktop', {
  isElectron: true,
  getLanUrls: () => ipcRenderer.invoke('get-lan-urls'),
});
