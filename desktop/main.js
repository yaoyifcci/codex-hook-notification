'use strict';
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, safeStorage, nativeImage, clipboard } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { EVENTS, atomicWrite, readJson, createReceiver, addRecord } = require('./core');

app.setAppUserModelId('com.codexhook.lannotify');
const lock = app.requestSingleInstanceLock(); if (!lock) app.quit();
let win, tray, server, settings, records, secret, configFile, recordsFile, status = '启动中', quitting = false;
const recentNotifications = new Map();
function persistSettings() { atomicWrite(configFile, settings); }
function persistRecords() { atomicWrite(recordsFile, records); }
function push() { if (win && !win.isDestroyed()) win.webContents.send('changed'); updateTray(); }
function updateTray() { if (!tray) return; tray.setToolTip(`Codex LAN Notify · ${status}`); tray.setContextMenu(Menu.buildFromTemplate([{label:'打开',click:showWindow},{label:settings.paused?'恢复提醒':'暂停提醒',click:()=>{settings.paused=!settings.paused;persistSettings();push();}},{label:'测试通知',click:testNotification},{type:'separator'},{label:'退出',click:()=>{quitting=true;app.quit();}}])); }
function showWindow(id) { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); if (id) win.webContents.send('show-record', id); }
function createWindow() { win = new BrowserWindow({ width: 880, height: 700, minWidth: 600, minHeight: 500, title:'Codex LAN Notify', webPreferences:{preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true} }); win.loadFile(path.join(__dirname,'index.html')); win.on('close', e=>{if(!quitting){e.preventDefault();win.hide();}}); }
function testNotification() { const n=new Notification({title:'Codex LAN Notify',body:'桌面通知测试'}); n.on('click',()=>showWindow());n.show(); }
function notify(event) {
  const record=records.find(r=>r.id===event.id); if (!record) return;
  if (settings.paused || (event.event !== 'Test' && !settings.enabled.includes(event.event))) {record.notification='disabled';persistRecords();return;}
  const group=JSON.stringify([event.source,event.session_id,event.event]); const now=Date.now();
  for (const [key, time] of recentNotifications) if (now-time>2000) recentNotifications.delete(key);
  if (recentNotifications.has(group)) {record.notification='merged';persistRecords();return;}
  recentNotifications.set(group, now);
  const project=event.cwd.split(/[\\/]/).filter(Boolean).pop() || event.cwd;
  try { const n=new Notification({title:`Codex · ${event.event}`,body:[ [event.source, project, event.tool_name].filter(Boolean).join(' · '), event.preview ].filter(Boolean).join('\n')}); n.on('click',()=>showWindow(event.id)); n.on('show',()=>{record.notification='shown';persistRecords();push();});n.on('failed',()=>{record.notification='failed';persistRecords();push();});n.show();record.notification='requested'; }
  catch {record.notification='failed';} persistRecords();
}
function receive(event) { const result=addRecord(records,event); if(result.duplicate)return true; const old=records; records=result.records; try{persistRecords();}catch(e){records=old;throw e;} setImmediate(()=>{try{notify(event);}catch(e){console.error('notification error',e);}push();}); return false; }
function startServer() { if(server){const old=server;server=null;status='重启中';push();old.close(()=>startServer());return;} status='启动中';push(); const current=createReceiver({getKey:()=>secret,accept:receive,onError:e=>console.error('receiver error',e)});server=current; current.on('error',e=>{if(server===current){status=`监听失败：${e.message}`;push();}}); current.listen(settings.port,settings.host,()=>{if(server===current){status=`监听中 ${settings.host}:${settings.port}`;push();}}); }
function addresses() { return Object.values(os.networkInterfaces()).flat().filter(x=>x && x.family==='IPv4' && !x.internal).map(x=>x.address); }
function validSettings(v) { return v && typeof v.host==='string' && v.host.trim().length>0 && v.host.length<256 && Number.isInteger(v.port) && v.port>0 && v.port<=65535 && Array.isArray(v.enabled) && v.enabled.length<=100 && v.enabled.every(x=>typeof x==='string' && x.length<=128); }
function initialize() {
  configFile=path.join(app.getPath('userData'),'settings.json');recordsFile=path.join(app.getPath('userData'),'records.json');
  settings=readJson(configFile,null); records=readJson(recordsFile,[]); if(!Array.isArray(records))throw Error('记录文件格式错误'); records=records.slice(0,500);
  if (!safeStorage.isEncryptionAvailable()) throw Error('系统安全存储不可用，无法保存密钥');
  if(!settings) { secret=crypto.randomBytes(32).toString('hex'); settings={host:'0.0.0.0',port:19280,enabled:['Stop','PermissionRequest'],paused:false,key:safeStorage.encryptString(secret).toString('base64')};persistSettings(); }
  else {if(!validSettings(settings) || typeof settings.key!=='string')throw Error('配置文件格式错误'); secret=safeStorage.decryptString(Buffer.from(settings.key,'base64'));}
  ipcMain.handle('snapshot',()=>({settings:{host:settings.host,port:settings.port,enabled:settings.enabled,paused:settings.paused},key:secret,status,addresses:addresses(),events:EVENTS,records}));
  ipcMain.handle('save-settings',(_,v)=>{if(!validSettings(v))throw Error('监听地址、端口或事件设置无效');const restart=v.host!==settings.host || v.port!==settings.port;settings={...settings,host:v.host.trim(),port:v.port,enabled:[...new Set(v.enabled)],paused:!!v.paused};persistSettings();if(restart)startServer();else push();});
  ipcMain.handle('rotate-key',()=>{const next=crypto.randomBytes(32).toString('hex');settings.key=safeStorage.encryptString(next).toString('base64');persistSettings();secret=next;push();});
  ipcMain.handle('copy-key',()=>clipboard.writeText(secret));
  ipcMain.handle('clear-records',()=>{records=[];persistRecords();push();});
  ipcMain.handle('test-notification',()=>testNotification());
  createWindow(); const icon=nativeImage.createFromPath(path.join(__dirname,'icon.png'));tray=new Tray(icon);updateTray();tray.on('click',()=>showWindow());startServer();
}
app.on('second-instance',()=>showWindow());app.on('activate',()=>showWindow());app.on('before-quit',()=>{quitting=true;if(server)server.close();});app.on('window-all-closed',()=>{});
if(lock) app.whenReady().then(()=>{try{initialize();}catch(e){require('electron').dialog.showErrorBox('启动失败',e.message);quitting=true;app.quit();}});
