// Só para desenvolvimento no Mac: faz o Electron.app de node_modules aparecer como "DirectHub"
// (Dock, Cmd+Tab, menu). Idempotente; fora do macOS não faz nada. Não entra no pacote.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'darwin') process.exit(0);

const NAME = 'DirectHub';
const root = path.join(__dirname, '..');
const bundle = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plist = path.join(bundle, 'Contents', 'Info.plist');
const icns = path.join(bundle, 'Contents', 'Resources', 'electron.icns');
const stamp = path.join(bundle, 'Contents', 'Resources', '.directhub-icon');
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

if (!fs.existsSync(plist)) process.exit(0);

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }).toString();
const iconPng = path.join(root, 'assets', 'icon.png');
const iconId = String(fs.statSync(iconPng).mtimeMs);

try {
  let changed = false;
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    let current = '';
    try { current = run('plutil', ['-extract', key, 'raw', '-o', '-', plist]).trim(); } catch {}
    if (current !== NAME) {
      run('plutil', ['-replace', key, '-string', NAME, plist]);
      changed = true;
    }
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
