const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('directHub', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (label, service) => ipcRenderer.invoke('accounts:add', label, service),
  activateAccount: (id) => ipcRenderer.invoke('accounts:activate', id),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  setAccountDialogOpen: (isOpen) => ipcRenderer.invoke('ui:set-account-dialog-open', isOpen),
  requestMediaAccess: () => ipcRenderer.invoke('media:request-access'),
  onAccountsChanged: (callback) => {
    const listener = (_event, accounts) => callback(accounts);
    ipcRenderer.on('accounts:changed', listener);
    return () => ipcRenderer.removeListener('accounts:changed', listener);
  }
});
