'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  snapshot:()=>ipcRenderer.invoke('snapshot'), saveSettings:v=>ipcRenderer.invoke('save-settings',v), rotateKey:()=>ipcRenderer.invoke('rotate-key'), copyKey:()=>ipcRenderer.invoke('copy-key'), clearRecords:()=>ipcRenderer.invoke('clear-records'), testNotification:()=>ipcRenderer.invoke('test-notification'),
  onChanged:fn=>ipcRenderer.on('changed',()=>fn()), onShowRecord:fn=>ipcRenderer.on('show-record',(_,id)=>fn(id))
});
