'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('classicLyrics', Object.freeze({
  command: (command, argument) => ipcRenderer.invoke('command', command, argument),
  onStatus: callback => { const listener = (_event, status) => callback(status); ipcRenderer.on('status', listener); return () => ipcRenderer.removeListener('status', listener); }
}));
