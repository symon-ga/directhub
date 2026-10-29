const { randomUUID } = require('node:crypto');
const { mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const path = require('node:path');

const MAX_LABEL_LENGTH = 48;
const SERVICES = ['whatsapp', 'instagram'];

function normalizeLabel(value) {
  if (typeof value !== 'string') {
    throw new TypeError('O nome da conta deve ser texto.');
  }

  const label = value.trim().replace(/\s+/g, ' ');
  if (!label) {
    throw new Error('Indique um nome para a conta.');
  }
  if (label.length > MAX_LABEL_LENGTH) {
    throw new Error(`O nome deve ter no máximo ${MAX_LABEL_LENGTH} caracteres.`);
  }

  return label;
}

function normalizeService(value) {
  if (!SERVICES.includes(value)) {
    throw new Error('Serviço desconhecido.');
  }
  return value;
}

function isStoredAccount(value) {
  return (
    value &&
    typeof value.id === 'string' &&
    /^[0-9a-f-]{36}$/i.test(value.id) &&
    typeof value.label === 'string' &&
    typeof value.createdAt === 'string'
  );
}

class AccountStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.accounts = [];
  }

  async load() {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      this.accounts = Array.isArray(parsed.accounts)
        ? parsed.accounts.filter(isStoredAccount).map((account) => ({
            ...account,
            label: normalizeLabel(account.label),
            // Accounts saved before Instagram support are WhatsApp sessions.
            service: SERVICES.includes(account.service) ? account.service : 'whatsapp'
          }))
        : [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.accounts = [];
        return;
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Não foi possível ler as contas guardadas: ${error.message}`);
      }
      throw error;
    }
  }

  list() {
    return this.accounts.map((account) => ({ ...account }));
  }

  async add(label, service) {
    const account = {
      id: randomUUID(),
      label: normalizeLabel(label),
      service: normalizeService(service),
      createdAt: new Date().toISOString()
    };
    this.accounts.push(account);
    await this.persist();
    return { ...account };
  }

  async remove(id) {
    if (typeof id !== 'string') return false;

    const initialLength = this.accounts.length;
    this.accounts = this.accounts.filter((account) => account.id !== id);
    if (this.accounts.length === initialLength) return false;

    await this.persist();
    return true;
  }

  async persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const document = JSON.stringify({ version: 1, accounts: this.accounts }, null, 2);
    await writeFile(temporaryPath, document, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}

module.exports = { AccountStore, normalizeLabel, SERVICES };
