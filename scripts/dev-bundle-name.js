// Só para desenvolvimento no Mac: faz o Electron.app de node_modules aparecer como "DirectHub"
// (Dock, Cmd+Tab, menu, Privacidade e Segurança). Idempotente; fora do macOS não faz nada. Não entra no pacote.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'darwin') process.exit(0);

const NAME = 'DirectHub';
// Identidade própria: o macOS guarda microfone/câmera por identificador; com o
// com.github.Electron de fábrica o DirectHub não aparece em Privacidade e Segurança.
const ID = 'com.symonga.directhub.dev';
const KEYS = {
  CFBundleName: NAME,
  CFBundleDisplayName: NAME,
  CFBundleIdentifier: ID,
  NSMicrophoneUsageDescription: 'O DirectHub usa o microfone para áudios e chamadas.',
  NSCameraUsageDescription: 'O DirectHub usa a câmera para chamadas de vídeo.',
};
const root = path.join(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const factoryBundle = path.join(electronDir, 'dist', 'Electron.app');
const bundle = path.join(electronDir, 'dist', `${NAME}.app`);
const pathTxt = path.join(electronDir, 'path.txt');
const EXEC = `${NAME}.app/Contents/MacOS/Electron`;
const plist = path.join(bundle, 'Contents', 'Info.plist');
const icns = path.join(bundle, 'Contents', 'Resources', 'electron.icns');
const stamp = path.join(bundle, 'Contents', 'Resources', '.directhub-icon');
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

// O Dock e o Finder mostram o nome da pasta: Electron.app vira DirectHub.app.
// Um npm install recria Electron.app; a cópia nova substitui a renomeada.
try {
  if (fs.existsSync(factoryBundle)) {
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.renameSync(factoryBundle, bundle);
  }
  if (fs.existsSync(bundle) && fs.readFileSync(pathTxt, 'utf8') !== EXEC) fs.writeFileSync(pathTxt, EXEC);
} catch (err) {
  console.warn(`dev-bundle-name: ${err.message.split('\n')[0]}`);
}

if (!fs.existsSync(plist)) process.exit(0);

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }).toString();
const iconPng = path.join(root, 'assets', 'icon.png');
const iconId = String(fs.statSync(iconPng).mtimeMs);

try {
  let changed = false;
  const setKey = (file, key, value) => {
    let current = '';
    try { current = run('plutil', ['-extract', key, 'raw', '-o', '-', file]).trim(); } catch {}
    if (current !== value) {
      run('plutil', ['-replace', key, '-string', value, file]);
      changed = true;
    }
  };
  for (const [key, value] of Object.entries(KEYS)) setKey(plist, key, value);
  const frameworks = path.join(bundle, 'Contents', 'Frameworks');
  for (const helper of fs.readdirSync(frameworks).filter((name) => name.endsWith('.app'))) {
    setKey(path.join(frameworks, helper, 'Contents', 'Info.plist'), 'CFBundleIdentifier', `${ID}.helper`);
  }

  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== iconId) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'directhub-icon-'));
    try {
      const set = path.join(tmp, 'icon.iconset');
      fs.mkdirSync(set);
      for (const size of [16, 32, 128, 256, 512]) {
        run('sips', ['-z', size, size, iconPng, '--out', path.join(set, `icon_${size}x${size}.png`)]);
        run('sips', ['-z', size * 2, size * 2, iconPng, '--out', path.join(set, `icon_${size}x${size}@2x.png`)]);
      }
      run('iconutil', ['-c', 'icns', set, '-o', path.join(tmp, 'icon.icns')]);
      fs.copyFileSync(path.join(tmp, 'icon.icns'), icns);
      fs.writeFileSync(stamp, iconId);
      changed = true;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // A run interrupted before signing leaves the stamps in place; the broken signature still triggers a re-sign.
  if (!changed) {
    try { run('codesign', ['--verify', bundle]); } catch { changed = true; }
  }
  if (changed) {
    run('codesign',['--force', '--deep', '-s', '-', bundle]);
    try { run(LSREGISTER, ['-f', bundle]); } catch {}
  }
} catch (err) {
  console.warn(`dev-bundle-name: ${err.message.split('\n')[0]}`);
}
