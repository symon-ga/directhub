const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { AccountStore } = require('./account-store');
const { SERVICES, isTrustedUrl, isAllowedUrl } = require('./services');
const secrets = require('./email/secrets');
const mail = require('./email/mail');

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

const EMAIL_POLL_MS = 60_000;

// Links leaving the services open in the default browser; other schemes (file:, custom app handlers) are dropped.
function openExternal(url) {
  try {
    if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url);
  } catch {}
}

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
      openExternal(url);
    }
    return { action: 'deny' };
  });
  webContents.on('did-create-window', (child) => {
    child.webContents.setUserAgent(COMPATIBLE_USER_AGENT);
    child.webContents.setWindowOpenHandler(({ url }) => {
      if (!isTrustedUrl(service, url)) openExternal(url);
      return { action: 'deny' };
    });
    child.webContents.on('will-navigate', (event, url) => {
      if (isAllowedUrl(service, url)) return;
      event.preventDefault();
      if (!isTrustedUrl(service, url)) openExternal(url);
    });
  });
  webContents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(service, url)) return;
    event.preventDefault();
    if (isTrustedUrl(service, url)) {
      webContents.loadURL(config.url);
    } else {
      openExternal(url);
    }
  });
  webContents.on('will-redirect', (event, url) => {
    // Iframes (Google sign-in helpers, attachments) redirect on their own; only the page itself is restricted.
    if (!event.isMainFrame || isAllowedUrl(service, url)) return;
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

// Contas de e-mail não usam página web: o leitor é uma vista local (HTML do app), sem sessão persistente.
function createEmailView(account) {
  const existing = viewsByAccountId.get(account.id);
  if (existing) return existing;
  const view = new WebContentsView({
    webPreferences: {
      partition: `email-${account.id}`,
      preload: path.join(__dirname, 'email-ui', 'preload.js'),
      additionalArguments: [`--email-account=${account.id}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false
    }
  });
  view.setVisible(false);

  const { webContents } = view;
  webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event) => event.preventDefault());
  webContents.once('destroyed', () => {
    viewsByAccountId.delete(account.id);
  });

  viewsByAccountId.set(account.id, view);
  mainWindow.contentView.addChildView(view);
  webContents.loadFile(path.join(__dirname, 'email-ui', 'index.html'));
  return view;
}

function ensureServiceView(account) {
  if (account.service === 'email') return createEmailView(account);
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
  if (account.service === 'email') {
    await mail.closeConnection(id);
    await secrets.removeSecret(id);
  } else {
    await session.fromPartition(getPartition(account)).clearStorageData();
  }
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

function getEmailAccount(id) {
  const account = getAccount(id);
  if (!account || account.service !== 'email') throw new Error('Conta de e-mail não encontrada.');
  return account;
}

function validUid(uid) {
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('Mensagem inválida.');
  return uid;
}

// Sem IDLE na v0: STATUS da caixa de entrada a cada minuto enquanto o app está aberto.
// Senha recusada para a consulta automática (o Gmail bloqueia o IMAP depois de muitas falhas);
// volta quando a conta abre a caixa de novo com sucesso.
const emailAuthFailed = new Set();

async function refreshEmailUnread() {
  const accounts = accountStore.list().filter((account) => account.service === 'email' && !emailAuthFailed.has(account.id));
  await Promise.all(
    accounts.map(async (account) => {
      try {
        const count = await mail.unreadCount(account);
        if (!getAccount(account.id)) return mail.closeConnection(account.id);
        unreadByAccountId.set(account.id, count);
      } catch (error) {
        if (error.authenticationFailed) emailAuthFailed.add(account.id);
      }
    })
  );
  sendAccountsChanged();
}

function validateRendererEvent(event) {
  if (event.sender !== mainWindow?.webContents) {
    throw new Error('Pedido recusado.');
  }
}

// Chamadas email:* vêm da janela principal ou da vista de leitura da própria conta.
function validateEmailEvent(event, accountId) {
  if (event.sender === mainWindow?.webContents) return;
  if (event.sender !== viewsByAccountId.get(accountId)?.webContents) throw new Error('Pedido recusado.');
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

  // fields (só e-mail): { address, provider, imapHost, smtpHost, password }. A senha vai direto para o cofre.
  ipcMain.handle('accounts:add', async (event, label, service, fields) => {
    validateRendererEvent(event);
    const { password, ...emailFields } = fields || {};
    const account = await accountStore.add(label, service, emailFields);
    if (service === 'email') {
      try {
        // Colar da página do Google costuma trazer espaço ou quebra de linha nas pontas.
        if (password?.trim()) await secrets.setSecret(account.id, password.trim());
        await mail.unreadCount(account);
      } catch (error) {
        await mail.closeConnection(account.id);
        await secrets.removeSecret(account.id).catch(() => {});
        await accountStore.remove(account.id);
        const reason = error.authenticationFailed
          ? 'o servidor recusou o endereço ou a senha de app. Confira os dois (no Mac, com a senha em branco, vale a do Keychain).'
          : error.responseText || error.message;
        throw new Error(`Não foi possível entrar na caixa de e-mail: ${reason}`);
      }
      void refreshEmailUnread();
    }
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

  ipcMain.handle('email:list', async (event, accountId, limit) => {
    validateEmailEvent(event, accountId);
    const messages = await mail.listInbox(getEmailAccount(accountId), Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50);
    emailAuthFailed.delete(accountId);
    return messages;
  });

  ipcMain.handle('email:get', (event, accountId, uid) => {
    validateEmailEvent(event, accountId);
    return mail.getMessage(getEmailAccount(accountId), validUid(uid));
  });

  ipcMain.handle('email:markSeen', async (event, accountId, uid) => {
    validateEmailEvent(event, accountId);
    await mail.markSeen(getEmailAccount(accountId), validUid(uid));
    void refreshEmailUnread();
  });

  // message: { to, cc, subject, text, inReplyTo?, references? } (to/cc: texto ou lista de textos).
  ipcMain.handle('email:send', (event, accountId, message) => {
    validateEmailEvent(event, accountId);
    const account = getEmailAccount(accountId);
    const { to, cc, subject, text, inReplyTo, references } = message || {};
    const addresses = [to, cc].flat().filter((value) => value !== undefined && value !== '');
    if (!to || !addresses.every((value) => typeof value === 'string' && value.length <= 998)) throw new Error('Indique o destinatário.');
    if (typeof subject !== 'string' || typeof text !== 'string') throw new Error('Mensagem inválida.');
    return mail.send(account, { to, cc, subject, text, inReplyTo, references });
  });

  // Só este destino fixo: a página onde o Google cria senhas de app.
  ipcMain.handle('ui:open-app-passwords', (event) => {
    validateRendererEvent(event);
    openExternal('https://myaccount.google.com/apppasswords');
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
    title: 'DirectHub',
    icon: APP_ICON,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
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

// O nome do app deriva a pasta de dados; fixar a antiga mantém as sessões logadas.
app.setName('DirectHub');
app.setPath('userData', path.join(app.getPath('appData'), 'direct-hub'));
if (process.platform === 'win32') app.setAppUserModelId('com.symonga.directhub');

// Duas instâncias na mesma userData brigam pelas partições: a segunda só foca a primeira.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  accountStore = new AccountStore(path.join(app.getPath('userData'), 'accounts.json'));
  await accountStore.load();
  // O Gmail em webview foi descartado; seus cookies do Google não ficam no disco.
  const partitionsDir = path.join(app.getPath('userData'), 'Partitions');
  const stale = await fs.readdir(partitionsDir).catch(() => []);
  await Promise.all(stale.filter((name) => name.startsWith('gmail-')).map((name) => fs.rm(path.join(partitionsDir, name), { recursive: true, force: true })));
  if (process.platform === 'darwin') app.dock.setIcon(APP_ICON);
  registerIpc();
  createMainWindow();
  void refreshEmailUnread();
  setInterval(refreshEmailUnread, EMAIL_POLL_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  for (const account of accountStore?.list() || []) {
    if (account.service === 'email') void mail.closeConnection(account.id);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
