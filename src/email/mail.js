// Leitor de e-mail por IMAP/SMTP: uma conexão IMAP por conta, reaproveitada e refeita se cair.
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { getSecret } = require('./secrets');
const { resolveHosts, replySubject, replyReferences } = require('./pure');

const connections = new Map();

async function getClient(account) {
  const existing = connections.get(account.id);
  if (existing) {
    const client = await existing;
    if (client.usable) return client;
    connections.delete(account.id);
  }
  const connecting = (async () => {
    const pass = await getSecret(account);
    if (!pass) throw new Error('Senha de app não encontrada para esta conta.');
    const { imapHost, imapPort } = resolveHosts(account);
    const client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: true,
      auth: { user: account.address, pass },
      // Socket meio aberto depois de trocar de rede: desiste em 90 s, não nos 5 min padrão.
      socketTimeout: 90_000,
      logger: false
    });
    // Sem ouvinte, um erro de socket derruba o processo principal.
    client.on('error', () => {});
    client.on('close', () => {
      if (connections.get(account.id) === connecting) connections.delete(account.id);
    });
    await client.connect();
    return client;
  })();
  connections.set(account.id, connecting);
  connecting.catch(() => {
    if (connections.get(account.id) === connecting) connections.delete(account.id);
  });
  return connecting;
}

async function withInbox(account, action) {
  const client = await getClient(account);
  const lock = await client.getMailboxLock('INBOX');
  try {
    return await action(client);
  } finally {
    lock.release();
  }
}

function toPerson(entry) {
  return { name: entry?.name || '', address: entry?.address || '' };
}

function hasAttachment(node) {
  if (!node) return false;
  if (node.disposition && node.disposition.toLowerCase() === 'attachment') return true;
  return (node.childNodes || []).some(hasAttachment);
}

async function unreadCount(account) {
  const client = await getClient(account);
  const { unseen } = await client.status('INBOX', { unseen: true });
  return unseen;
}

async function listInbox(account, limit = 50) {
  return withInbox(account, async (client) => {
    // A conexão fica aberta: o NOOP traz mensagens chegadas desde a última chamada.
    await client.noop();
    const total = client.mailbox.exists;
    if (!total) return [];
    const start = Math.max(1, total - limit + 1);
    const messages = [];
    for await (const message of client.fetch(`${start}:*`, { uid: true, envelope: true, flags: true, bodyStructure: true })) {
      messages.push({
        uid: message.uid,
        from: toPerson(message.envelope.from?.[0]),
        subject: message.envelope.subject || '',
        date: message.envelope.date ? message.envelope.date.toISOString() : null,
        seen: message.flags.has('\\Seen'),
        hasAttachments: hasAttachment(message.bodyStructure)
      });
    }
    return messages.sort((a, b) => b.uid - a.uid);
  });
}

async function getMessage(account, uid) {
  const source = await withInbox(account, async (client) => {
    const message = await client.fetchOne(uid, { source: true }, { uid: true });
    return message ? message.source : null;
  });
  if (!source) throw new Error('Mensagem não encontrada.');
  const parsed = await simpleParser(source);
  const people = (field) => (field ? [field].flat().flatMap((group) => group.value).map(toPerson) : []);
  return {
    uid,
    from: toPerson(parsed.from?.value?.[0]),
    to: people(parsed.to),
    cc: people(parsed.cc),
    replyTo: people(parsed.replyTo),
    subject: parsed.subject || '',
    date: parsed.date ? parsed.date.toISOString() : null,
    text: parsed.text || '',
    html: parsed.html || '',
    messageId: parsed.messageId || '',
    references: [parsed.references].flat().filter(Boolean),
    attachments: parsed.attachments.map((item) => ({
      filename: item.filename || '',
      size: item.size,
      contentType: item.contentType
    }))
  };
}

async function markSeen(account, uid) {
  await withInbox(account, (client) => client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }));
}

// Com inReplyTo (Message-ID do original) vira resposta: "Re: " sem duplicar, In-Reply-To e References.
async function send(account, { to, cc, subject, text, inReplyTo, references }) {
  const pass = await getSecret(account);
  if (!pass) throw new Error('Senha de app não encontrada para esta conta.');
  const { smtpHost, smtpPort } = resolveHosts(account);
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: true,
    auth: { user: account.address, pass }
  });
  try {
    const message = { from: account.address, to, cc, subject, text };
    if (inReplyTo) {
      message.subject = replySubject(subject);
      message.inReplyTo = inReplyTo;
      message.references = replyReferences(references, inReplyTo);
    }
    const info = await transport.sendMail(message);
    return { messageId: info.messageId, response: info.response };
  } finally {
    transport.close();
  }
}

async function closeConnection(accountId) {
  const connecting = connections.get(accountId);
  connections.delete(accountId);
  if (!connecting) return;
  try {
    await (await connecting).logout();
  } catch {}
}

module.exports = { unreadCount, listInbox, getMessage, markSeen, send, closeConnection };
