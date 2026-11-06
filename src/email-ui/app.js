const listEl = document.getElementById('list');
const readerEl = document.getElementById('reader');
const refreshBtn = document.getElementById('refresh');

let messages = [];
let openUid = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function longDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
}

function person(p) {
  if (!p) return '';
  return p.name && p.address ? `${p.name} <${p.address}>` : p.name || p.address || '';
}

function size(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function showListState(text, error) {
  listEl.replaceChildren();
  const box = el('div', error ? 'state error' : 'state', text);
  if (error) {
    const retry = el('button', 'btn', 'Tentar de novo');
    retry.type = 'button';
    retry.addEventListener('click', loadList);
    box.append(document.createElement('br'), retry);
  }
  listEl.append(box);
}

function renderList() {
  if (!messages.length) return showListState('Nenhuma mensagem na caixa de entrada.');
  listEl.replaceChildren(...messages.map((message) => {
    const row = el('button', 'row');
    row.type = 'button';
    row.setAttribute('role', 'listitem');
    row.dataset.uid = message.uid;
    row.classList.toggle('unread', !message.seen);
    row.classList.toggle('active', message.uid === openUid);
    const meta = el('span', 'row-meta');
    if (message.hasAttachments) meta.append(el('span', 'clip', '📎'));
    meta.append(shortDate(message.date));
    row.append(
      el('span', 'dot'),
      el('span', 'row-from', message.from?.name || message.from?.address || '(sem remetente)'),
      meta,
      el('span', 'row-subject', message.subject || '(sem assunto)')
    );
    row.addEventListener('click', () => openMessage(message.uid));
    return row;
  }));
}

async function loadList() {
  refreshBtn.disabled = true;
  showListState('Carregando…');
  try {
    messages = await window.emailApi.list(50);
    renderList();
  } catch (error) {
    showListState(`Não foi possível falar com o servidor: ${cleanError(error)}`, true);
  } finally {
    refreshBtn.disabled = false;
  }
}

function cleanError(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function frameDoc(html, withImages) {
  const img = withImages ? 'data: cid: https:' : 'data: cid:';
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; script-src 'none'; object-src 'none'; form-action 'none'; font-src 'none'; frame-src 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:16px;font-family:system-ui,sans-serif;color:#111;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}

function headerRow(dl, label, value) {
  if (!value) return;
  dl.append(el('dt', '', label), el('dd', '', value));
}

function renderMessage(message) {
  const head = el('header', 'msg-head');
  const top = el('div', 'msg-top');
  top.append(el('h1', 'msg-subject', message.subject || '(sem assunto)'));
  const actions = el('div', 'msg-actions');
  actions.id = 'msg-actions'; // agente 3 liga Responder/Escrever aqui
  for (const [id, label] of [['reply', 'Responder'], ['compose', 'Escrever']]) {
    const b = el('button', 'btn', label);
    b.type = 'button';
    b.id = id;
    actions.append(b);
  }
  top.append(actions);
  const meta = el('dl', 'msg-meta');
  headerRow(meta, 'De', person(message.from));
  headerRow(meta, 'Para', (message.to || []).map(person).join(', '));
  headerRow(meta, 'Cc', (message.cc || []).map(person).join(', '));
  headerRow(meta, 'Data', longDate(message.date));
  head.append(top, meta);
  if (message.attachments?.length) {
    const ul = el('ul', 'attachments');
    for (const a of message.attachments) {
      const li = el('li', '', a.filename || 'anexo');
      li.append(' ', el('span', '', size(a.size)));
      ul.append(li);
    }
    head.append(ul);
  }
  readerEl.replaceChildren(head);

  if (message.html) {
    const frame = el('iframe', 'body-frame');
    frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    frame.title = 'Corpo da mensagem';
    frame.srcdoc = frameDoc(message.html, false);
    const bar = el('div', 'img-bar', 'Imagens remotas bloqueadas.');
    const show = el('button', 'btn', 'Mostrar imagens');
    show.type = 'button';
    show.addEventListener('click', () => {
      frame.srcdoc = frameDoc(message.html, true);
      bar.remove();
    });
    bar.append(show);
    readerEl.append(bar, frame);
  } else {
    readerEl.append(el('pre', 'body-text', message.text || '(mensagem vazia)'));
  }
}

async function openMessage(uid) {
  openUid = uid;
  renderList();
  readerEl.replaceChildren(el('p', 'placeholder', 'Carregando…'));
  try {
    const message = await window.emailApi.get(uid);
    if (openUid !== uid) return;
    renderMessage(message);
    const item = messages.find((m) => m.uid === uid);
    if (item && !item.seen) {
      item.seen = true;
      renderList();
      window.emailApi.markSeen(uid).catch(() => {});
    }
  } catch (error) {
    if (openUid === uid) readerEl.replaceChildren(el('p', 'placeholder', `Não foi possível abrir a mensagem: ${cleanError(error)}`));
  }
}

refreshBtn.addEventListener('click', loadList);
loadList();
