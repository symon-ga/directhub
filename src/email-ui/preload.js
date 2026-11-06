const { contextBridge, ipcRenderer } = require('electron');

const arg = process.argv.find((value) => value.startsWith('--email-account='));
const accountId = arg ? arg.slice('--email-account='.length) : '';
if (!/^[\w-]{1,64}$/.test(accountId)) throw new Error('Conta de e-mail inválida.');

contextBridge.exposeInMainWorld('emailApi', {
  list: (limit) => ipcRenderer.invoke('email:list', accountId, limit),
  get: (uid) => ipcRenderer.invoke('email:get', accountId, uid),
  markSeen: (uid) => ipcRenderer.invoke('email:markSeen', accountId, uid),
  send: (message) => ipcRenderer.invoke('email:send', accountId, message)
});
