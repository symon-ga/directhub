const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
const { AccountStore } = require('./account-store');
const { SERVICES, isTrustedUrl, isAllowedUrl } = require('./services');

const SIDEBAR_WIDTH = 268;
// App icon (assets/icon.png).
const APP_ICON = path.join(__dirname, '..', 'assets', 'icon.png');
// WhatsApp Web and Instagram reject Electron's product token even when its Chromium version is current.
// This matches the Chromium engine bundled with Electron 44 and is used only by the service views.
const COMPATIBLE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const ACCEPT_LANGUAGES = 'pt-BR,pt,en-US,en';

let mainWindow;
let accountStore;
let activeAccountId = null;
let accountDialogOpen = false;

const viewsByAccountId = new Map();
const unreadByAccountId = new Map();

function getPartition(account) {
  return `persist:${account.service}-${account.id}`;
}

function getAccount(id) {
  return accountStore.list().find((account) => account.id === id);
}

function getAccountsForRenderer() {
  return accountStore.list().map((account) => ({
    ...account,
    unreadCount: unreadByAccountId.get(account.id) || 0,
    active: account.id === activeAccountId
  }));
}

function sendAccountsChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('accounts:changed', getAccountsForRenderer());
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const bounds = {
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, width - SIDEBAR_WIDTH),
    height
  };

  for (const [accountId, view] of viewsByAccountId) {
    const visible = accountId === activeAccountId && !accountDialogOpen;
    view.setBounds(bounds);
    view.setVisible(visible);
  }
}

function configureServiceSession(account) {
  const { service } = account;
  const serviceSession = session.fromPartition(getPartition(account));

  serviceSession.setUserAgent(COMPATIBLE_USER_AGENT, ACCEPT_LANGUAGES);
  serviceSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const requestingUrl = details.requestingUrl || requestingOrigin || webContents?.getURL();
    return permission === 'media' && isTrustedUrl(service, requestingUrl);
  });
  serviceSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || details.securityOrigin || webContents.getURL();
    callback(permission === 'media' && isTrustedUrl(service, requestingUrl));
  });

  return serviceSession;
}

function createServiceView(account) {
  const { service } = account;
  const config = SERVICES[service];
  const view = new WebContentsView({
    webPreferences: {
      session: configureServiceSession(account),
      preload: path.join(__dirname, config.preload),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false
    }
  });

  view.setBackgroundColor('#f7f7f5');
  view.setVisible(false);

  const { webContents } = view;
  webContents.setUserAgent(COMPATIBLE_USER_AGENT);
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(service, url)) {
      webContents.loadURL(url);
    } else if (!isTrustedUrl(service, url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(service, url)) return;
    event.preventDefault();
    if (isTrustedUrl(service, url)) {
      webContents.loadURL(config.url);
    } else {
      shell.openExternal(url);
    }
  });
  webContents.on('will-redirect', (event, url) => {
    if (isAllowedUrl(service, url)) return;
    event.preventDefault();
    if (isTrustedUrl(service, url)) webContents.loadURL(config.url);
  });
  // Single-page navigation (feed, Explore…) never reaches will-navigate.
  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame && !isAllowedUrl(service, url)) webContents.loadURL(config.url);
  });
  webContents.on('did-finish-load', () => {
    if (config.css) webContents.insertCSS(config.css).catch(() => {});
  });
  webContents.once('destroyed', () => {
    viewsByAccountId.delete(account.id);
  });

  viewsByAccountId.set(account.id, view);
  mainWindow.contentView.addChildView(view);
  webContents.loadURL(config.url);
  return view;
}

function ensureServiceView(account) {
  return viewsByAccountId.get(account.id) || createServiceView(account);
}

function activateAccount(id) {
  const account = getAccount(id);
  if (!account) throw new Error('Conta não encontrada.');

  ensureServiceView(account);
  activeAccountId = account.id;
  layoutViews();
  sendAccountsChanged();
}

async function deleteAccount(id) {
  const account = getAccount(id);
  const view = viewsByAccountId.get(id);
  if (view) {
    mainWindow.contentView.removeChildView(view);
    view.webContents.close();
    viewsByAccountId.delete(id);
  }
  await session.fromPartition(getPartition(account)).clearStorageData();
  unreadByAccountId.delete(id);
  await accountStore.remove(id);

  if (activeAccountId === id) {
    const nextAccount = accountStore.list()[0];
    activeAccountId = nextAccount ? nextAccount.id : null;
    if (nextAccount) ensureServiceView(nextAccount);
  }
  layoutViews();
  sendAccountsChanged();
}

function validateRendererEvent(event) {
  if (event.sender !== mainWindow?.webContents) {
    throw new Error('Pedido recusado.');
  }
}

function setAccountDialogOpen(isOpen) {
  accountDialogOpen = isOpen;
  layoutViews();
}

async function requestMediaAccess() {
  if (process.platform !== 'darwin') {
    return { camera: 'requested-in-call', microphone: 'requested-in-call' };
  }

  const result = {};
  for (const mediaType of ['camera', 'microphone']) {
    const currentStatus = systemPreferences.getMediaAccessStatus(mediaType);
    if (currentStatus === 'not-determined') {
      await systemPreferences.askForMediaAccess(mediaType);
    }
    result[mediaType] = systemPreferences.getMediaAccessStatus(mediaType);
  }
  return result;
}

function registerIpc() {
  ipcMain.handle('accounts:list', (event) => {
    validateRendererEvent(event);
    return getAccountsForRenderer();
  });

  ipcMain.handle('accounts:add', async (event, label, service) => {
    validateRendererEvent(event);
    const account = await accountStore.add(label, service);
    activateAccount(account.id);
    return account;
  });

  ipcMain.handle('accounts:activate', (event, id) => {
    validateRendererEvent(event);
    activateAccount(id);
  });

  ipcMain.handle('accounts:remove', async (event, id) => {
    validateRendererEvent(event);
    if (!getAccount(id)) throw new Error('Conta não encontrada.');
    await deleteAccount(id);
  });

  ipcMain.handle('ui:set-account-dialog-open', (event, isOpen) => {
    validateRendererEvent(event);
    if (typeof isOpen !== 'boolean') throw new Error('Estado de diálogo inválido.');
    setAccountDialogOpen(isOpen);
  });

  ipcMain.handle('media:request-access', async (event) => {
    validateRendererEvent(event);
    return requestMediaAccess();
  });

  ipcMain.on('service:unread-count', (event, count) => {
    const accountId = [...viewsByAccountId.entries()].find(
      ([, view]) => view.webContents.id === event.sender.id
    )?.[0];
    if (!accountId || !Number.isSafeInteger(count) || count < 0 || count > 9999) return;

    unreadByAccountId.set(accountId, count);
    sendAccountsChanged();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Direct Hub',
    icon: APP_ICON,
    backgroundColor: '#111210',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('resize', layoutViews);
  mainWindow.on('closed', () => {
    for (const view of viewsByAccountId.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    viewsByAccountId.clear();
    accountDialogOpen = false;
    mainWindow = undefined;
  });

  const firstAccount = accountStore.list()[0];
  if (firstAccount) activateAccount(firstAccount.id);
}

app.whenReady().then(async () => {
  accountStore = new AccountStore(path.join(app.getPath('userData'), 'accounts.json'));
  await accountStore.load();
  if (process.platform === 'darwin') app.dock.setIcon(APP_ICON);
  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
