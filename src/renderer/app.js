const accountList = document.querySelector('#account-list');
const emptyState = document.querySelector('#empty-state');
const dialog = document.querySelector('#account-dialog');
const form = document.querySelector('#account-form');
const labelInput = document.querySelector('#account-label');
const serviceSelect = document.querySelector('#account-service');
const formError = document.querySelector('#form-error');
const mediaAccessButton = document.querySelector('#media-access');
const mediaStatus = document.querySelector('#media-status');

let accounts = [];

function render() {
  accountList.replaceChildren();
  emptyState.hidden = accounts.length > 0;

  for (const account of accounts) {
    const item = document.createElement('div');
    item.className = `account${account.active ? ' active' : ''}`;
    item.setAttribute('role', 'listitem');

    const selectButton = document.createElement('button');
    selectButton.className = 'account-select';
    selectButton.type = 'button';
    selectButton.title = `Abrir ${account.label} (${account.service === 'instagram' ? 'Instagram' : 'WhatsApp'})`;
    const avatar = document.createElement('span');
    avatar.className = `avatar ${account.service}`;
    avatar.textContent = account.label.slice(0, 1).toUpperCase();
    const accountName = document.createElement('span');
    accountName.className = 'account-name';
    accountName.textContent = account.label;
    selectButton.append(avatar, accountName);
    selectButton.addEventListener('click', () => void run(() => window.directHub.activateAccount(account.id)));

    const count = document.createElement('span');
    count.className = 'unread-count';
    count.textContent = account.unreadCount > 99 ? '99+' : String(account.unreadCount);
    count.hidden = account.unreadCount === 0;

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-account';
    removeButton.type = 'button';
    removeButton.setAttribute('aria-label', `Remover ${account.label}`);
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => void removeAccount(account));

    item.append(selectButton, count, removeButton);
    accountList.append(item);
  }
}

async function removeAccount(account) {
  if (!window.confirm(`Remover “${account.label}” deste dispositivo? A sessão guardada e os dados locais desta conta serão apagados.`)) return;
  await run(() => window.directHub.removeAccount(account.id));
}

async function run(action) {
  try {
    formError.textContent = '';
    await action();
  } catch (error) {
    formError.textContent = error.message || 'Não foi possível concluir a ação.';
    if (!dialog.open) await openAccountDialog({ reset: false });
  }
}

async function openAccountDialog({ reset = true } = {}) {
  await window.directHub.setAccountDialogOpen(true);
  if (reset) {
    form.reset();
    formError.textContent = '';
  }
  dialog.showModal();
  labelInput.focus();
}

document.querySelector('#add-account').addEventListener('click', () => void openAccountDialog());

document.querySelector('#cancel-account').addEventListener('click', () => dialog.close());

dialog.addEventListener('close', () => {
  void window.directHub.setAccountDialogOpen(false);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await run(async () => {
    await window.directHub.addAccount(labelInput.value, serviceSelect.value);
    dialog.close();
  });
});

mediaAccessButton.addEventListener('click', () => void requestMediaAccess());

async function requestMediaAccess() {
  mediaAccessButton.disabled = true;
  mediaStatus.textContent = 'A verificar permissões…';
  try {
    const access = await window.directHub.requestMediaAccess();
    const denied = [access.camera, access.microphone].some((status) => status === 'denied' || status === 'restricted');
    if (denied) {
      mediaStatus.textContent = 'Acesse Definições do Sistema › Privacidade e Segurança para liberar o Direct Hub.';
    } else if (access.camera === 'requested-in-call') {
      mediaStatus.textContent = 'A permissão será solicitada ao iniciar uma chamada.';
    } else {
      mediaStatus.textContent = 'Câmera e microfone liberados para chamadas.';
    }
  } catch (error) {
    mediaStatus.textContent = error.message || 'Não foi possível solicitar as permissões.';
  } finally {
    mediaAccessButton.disabled = false;
  }
}

window.directHub.onAccountsChanged((nextAccounts) => {
  accounts = nextAccounts;
  render();
});

window.directHub.listAccounts().then((nextAccounts) => {
  accounts = nextAccounts;
  render();
}).catch((error) => {
  formError.textContent = error.message || 'Não foi possível carregar as contas.';
});
