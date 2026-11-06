const listEl = document.getElementById('list');
const readerEl = document.getElementById('reader');
const refreshBtn = document.getElementById('refresh');

const { replySubject, parseRecipients, replyBody } = window.ComposePure;

const PAGE = 50;
let messages = [];
let hasOlder = false;
let openUid = null;
let currentMessage = null;

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
  if (hasOlder) {
    const more = el('button', 'btn more', 'Carregar mais');
    more.type = 'button';
    more.addEventListener('click', () => loadOlder(more));
    listEl.append(more);
  }
}

// Mais 50 mensagens antigas, a partir da menor UID já na lista.
async function loadOlder(button) {
  button.disabled = true;
  button.textContent = 'Carregando…';
  try {
    const oldest = Math.min(...messages.map((message) => message.uid));
    const older = await window.emailApi.list(PAGE, oldest);
    const known = new Set(messages.map((message) => message.uid));
    messages = messages.concat(older.filter((message) => !known.has(message.uid)));
    hasOlder = older.length === PAGE;
    const scroll = listEl.scrollTop;
    renderList();
    listEl.scrollTop = scroll;
  } catch (error) {
    button.disabled = false;
    button.textContent = `Tentar de novo (${cleanError(error)})`;
  }
}

async function loadList() {
  refreshBtn.disabled = true;
  showListState('Carregando…');
  try {
    messages = await window.emailApi.list(PAGE);
    hasOlder = messages.length === PAGE;
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="x-dns-prefetch-control" content="off"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:16px;font-family:system-ui,sans-serif;color:#111;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}

function headerRow(dl, label, value) {
  if (!value) return;
  dl.append(el('dt', '', label), el('dd', '', value));
}

function renderMessage(message) {
  currentMessage = message;
  const head = el('header', 'msg-head');
  const top = el('div', 'msg-top');
  top.append(el('h1', 'msg-subject', message.subject || '(sem assunto)'));
  const actions = el('div', 'msg-actions');
  actions.id = 'msg-actions';
  for (const [id, label] of [['reply', 'Responder'], ['compose', 'Escrever']]) {
    const b = el('button', 'btn', label);
    b.type = 'button';
    b.id = id;
    b.addEventListener('click', () => (id === 'reply' ? openCompose(message) : openCompose()));
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

// Texto puro de um e-mail só-HTML: documento inerte (sem scripts, imagens nem estilos), só textContent.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, head').forEach((node) => node.remove());
  doc.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote').forEach((node) => node.append('\n'));
  return doc.body.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function showToast(text) {
  const toast = el('div', 'toast', text);
  toast.setAttribute('role', 'status');
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2500);
}

function closeCompose() {
  if (currentMessage) renderMessage(currentMessage);
  else readerEl.replaceChildren(el('p', 'placeholder', 'Escolha uma mensagem para ler.'));
}

function field(labelText, control) {
  const wrap = el('label', 'cfield');
  wrap.append(el('span', 'cfield-label', labelText), control);
  return wrap;
}

// Painel de composição na área de leitura. original = mensagem aberta, quando é uma resposta.
function openCompose(original) {
  const input = (value) => {
    const node = el('input', 'cinput');
    node.type = 'text';
    node.autocomplete = 'off';
    node.spellcheck = false;
    node.value = value;
    return node;
  };
  // Formulários e listas mandam a resposta para o Reply-To, não para o remetente.
  const to = input(original?.replyTo?.[0]?.address || original?.from?.address || '');
  const cc = input('');
  const subject = input(original ? replySubject(original.subject) : '');
  subject.spellcheck = true;
  const body = el('textarea', 'cbody');
  body.value = original ? replyBody(original, original.text || htmlToText(original.html || '')) : '';
  body.setAttribute('aria-label', 'Mensagem');
  const status = el('span', 'cstatus');
  status.setAttribute('role', 'alert');
  const send = el('button', 'btn primary', 'Enviar');
  send.type = 'button';
  const cancel = el('button', 'btn', 'Cancelar');
  cancel.type = 'button';
  const bar = el('div', 'cbar');
  bar.append(status, cancel, send);

  const panel = el('form', 'compose');
  panel.noValidate = true;
  panel.append(
    el('h1', 'msg-subject', original ? 'Responder' : 'Nova mensagem'),
    field('Para', to), field('Cc', cc), field('Assunto', subject), body, bar
  );
  readerEl.replaceChildren(panel);
  (original ? body : to).focus();
  if (original) body.setSelectionRange(0, 0);

  let emptyOk = false;
  const fail = (text) => { status.textContent = text; status.className = 'cstatus error'; };
  body.addEventListener('input', () => { emptyOk = false; status.textContent = ''; });

  async function submit() {
    if (send.disabled) return;
    const toList = parseRecipients(to.value);
    const ccList = parseRecipients(cc.value);
    const invalid = [...toList.invalid, ...ccList.invalid];
    if (invalid.length) return fail(`Endereço inválido: ${invalid.join(', ')}`);
    if (!toList.list.length) return fail('Indique pelo menos um destinatário em Para.');
    if (!body.value.trim() && !emptyOk) {
      emptyOk = true;
      status.className = 'cstatus';
      status.textContent = 'A mensagem está vazia. Clique em Enviar de novo para enviar assim mesmo.';
      return;
    }
    const payload = { to: toList.list, subject: subject.value, text: body.value };
    if (ccList.list.length) payload.cc = ccList.list;
    if (original?.messageId) {
      payload.inReplyTo = original.messageId;
      payload.references = Array.isArray(original.references) ? original.references.join(' ') : original.references || '';
    }
    send.disabled = true;
    send.textContent = 'Enviando…';
    status.textContent = '';
    try {
      await window.emailApi.send(payload);
      showToast('Enviado');
      closeCompose();
    } catch (error) {
      send.disabled = false;
      send.textContent = 'Enviar';
      fail(`Não foi possível enviar: ${cleanError(error)}`);
    }
  }

  send.addEventListener('click', submit);
  cancel.addEventListener('click', closeCompose);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  });
}

document.getElementById('new-mail').addEventListener('click', () => openCompose());

refreshBtn.addEventListener('click', loadList);
loadList();
