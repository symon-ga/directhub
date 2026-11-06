// Funções puras do e-mail (sem rede, sem Electron): presets, validação e montagem de resposta.
const PROVIDERS = {
  google: { imapHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com' }
};
const IMAP_PORT = 993;
const SMTP_PORT = 465;

const ADDRESS_PATTERN = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

function isValidAddress(value) {
  return typeof value === 'string' && value.length <= 254 && ADDRESS_PATTERN.test(value.trim());
}

function normalizeHost(value, name) {
  const host = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!HOST_PATTERN.test(host)) throw new Error(`Servidor ${name} inválido.`);
  return host;
}

// Valida os campos de uma conta de e-mail e devolve só o que vai para o accounts.json.
function normalizeEmailFields({ address, provider = 'google', imapHost, smtpHost } = {}) {
  if (!isValidAddress(address)) throw new Error('Indique um endereço de e-mail válido.');
  if (provider === 'google') return { address: address.trim(), provider };
  if (provider === 'custom') {
    return {
      address: address.trim(),
      provider,
      imapHost: normalizeHost(imapHost, 'IMAP'),
      smtpHost: normalizeHost(smtpHost, 'SMTP')
    };
  }
  throw new Error('Provedor de e-mail desconhecido.');
}

// Hosts e portas fixas (TLS direto) de uma conta de e-mail já normalizada.
function resolveHosts(account) {
  const hosts = account.provider === 'custom' ? account : PROVIDERS[account.provider || 'google'];
  if (!hosts) throw new Error('Provedor de e-mail desconhecido.');
  return { imapHost: hosts.imapHost, imapPort: IMAP_PORT, smtpHost: hosts.smtpHost, smtpPort: SMTP_PORT };
}

function replySubject(subject) {
  const text = String(subject || '').trim();
  return /^re:/i.test(text) ? text : `Re: ${text}`.trim();
}

function quoteText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

// References da resposta = References do original + Message-ID do original.
function replyReferences(references, messageId) {
  const list = Array.isArray(references) ? references : String(references || '').split(/\s+/);
  return [...list, messageId].filter(Boolean).join(' ');
}

module.exports = { PROVIDERS, isValidAddress, normalizeEmailFields, resolveHosts, replySubject, quoteText, replyReferences };
