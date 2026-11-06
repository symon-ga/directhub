const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AccountStore, normalizeLabel } = require('../src/account-store');

test('normalizes a readable account label', () => {
  assert.equal(normalizeLabel('  Conta   Trabalho  '), 'Conta Trabalho');
  assert.throws(() => normalizeLabel('  '), /Indique um nome/);
});

test('persists accounts and restores them in a new store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'direct-hub-'));
  const filePath = path.join(directory, 'accounts.json');

  try {
    const firstStore = new AccountStore(filePath);
    await firstStore.load();
    const account = await firstStore.add('Trabalho', 'instagram');

    const stored = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(stored.accounts[0].id, account.id);
    assert.equal(stored.accounts[0].service, 'instagram');

    const secondStore = new AccountStore(filePath);
    await secondStore.load();
    assert.deepEqual(secondStore.list(), [account]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('treats accounts saved without a service as WhatsApp', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'direct-hub-'));
  const filePath = path.join(directory, 'accounts.json');

  try {
    const legacy = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', label: 'Pessoal', createdAt: '2026-09-23T12:00:00.000Z' };
    await writeFile(filePath, JSON.stringify({ version: 1, accounts: [legacy] }));

    const store = new AccountStore(filePath);
    await store.load();
    assert.equal(store.list()[0].service, 'whatsapp');
    await assert.rejects(store.add('Outra', 'telegram'), /Serviço desconhecido/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('discards old Gmail webview accounts on load', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'direct-hub-'));
  const filePath = path.join(directory, 'accounts.json');

  try {
    const gmail = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae8', label: 'Gmail', service: 'gmail', createdAt: '2026-09-23T12:00:00.000Z' };
    const legacy = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', label: 'Pessoal', createdAt: '2026-09-23T12:00:00.000Z' };
    await writeFile(filePath, JSON.stringify({ version: 1, accounts: [gmail, legacy] }));

    const store = new AccountStore(filePath);
    await store.load();
    assert.deepEqual(store.list().map((account) => account.service), ['whatsapp']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stores email accounts with address and provider, never a password', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'direct-hub-'));
  const filePath = path.join(directory, 'accounts.json');

  try {
    const store = new AccountStore(filePath);
    await store.load();
    const google = await store.add('Pessoal', 'email', { address: 'a@gmail.com', password: 'segredo' });
    assert.equal(google.service, 'email');
    assert.equal(google.provider, 'google');
    const custom = await store.add('Outro', 'email', { address: 'b@exemplo.com.br', provider: 'custom', imapHost: 'imap.exemplo.com.br', smtpHost: 'smtp.exemplo.com.br' });
    assert.equal(custom.imapHost, 'imap.exemplo.com.br');
    assert.doesNotMatch(await readFile(filePath, 'utf8'), /segredo/);
    await assert.rejects(store.add('X', 'email', { address: 'sem-arroba' }), /e-mail válido/);
    await assert.rejects(store.add('X', 'email', { address: 'c@x.com', provider: 'custom', imapHost: 'ruim host' }), /IMAP/);
    await assert.rejects(store.add('X', 'gmail'), /Serviço desconhecido/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
