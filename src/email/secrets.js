// Senha de app: cifrada com safeStorage num arquivo em userData (base64 por id de conta).
// No Mac, sem segredo salvo, tenta o Keychain (item "directhub-imap", conta = endereço).
const { execFile } = require('node:child_process');
const { readFile, rename, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { app, safeStorage } = require('electron');

const run = promisify(execFile);
const filePath = () => path.join(app.getPath('userData'), 'email-secrets.json');

async function readAll() {
  try {
    return JSON.parse(await readFile(filePath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeAll(secrets) {
  const temporaryPath = `${filePath()}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(secrets), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath());
}

async function setSecret(accountId, password) {
  if (typeof password !== 'string' || !password) throw new Error('Indique a senha de app.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Este computador não oferece cofre para guardar a senha.');
  const secrets = await readAll();
  secrets[accountId] = safeStorage.encryptString(password).toString('base64');
  await writeAll(secrets);
}

async function getSecret(account) {
  const stored = (await readAll())[account.id];
  if (stored) return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await run('security', ['find-generic-password', '-a', account.address, '-s', 'directhub-imap', '-w']);
    return stdout.replace(/\n$/, '') || null;
  } catch {
    return null;
  }
}

async function removeSecret(accountId) {
  const secrets = await readAll();
  if (!(accountId in secrets)) return;
  delete secrets[accountId];
  await writeAll(secrets);
}

module.exports = { setSecret, getSecret, removeSecret };
