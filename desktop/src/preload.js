const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relay', {
  getMachineConfig: () => ipcRenderer.invoke('relay:getMachineConfig'),
  writeMachineConfig: (vars) => ipcRenderer.invoke('relay:writeMachineConfig', vars),
  getHookStatus: () => ipcRenderer.invoke('relay:getHookStatus'),
  setHookEnabled: (enable) => ipcRenderer.invoke('relay:setHookEnabled', enable),
  getHostname: () => ipcRenderer.invoke('system:getHostname'),
});

// Multi-harness API — lists installed harnesses and toggles mobile support per harness.
contextBridge.exposeInMainWorld('harness', {
  list: () => ipcRenderer.invoke('harness:list'),
  setMobile: (harness, enable) => ipcRenderer.invoke('harness:setMobile', { harness, enable }),
});

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb) => {
    ipcRenderer.on('window:maximizeChange', (_, val) => cb(val));
  },
});
