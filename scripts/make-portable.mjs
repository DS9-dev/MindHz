// Builds release/MindHz-Portable-<version>.zip from release/win-unpacked.
// The marker file portable.txt switches MindHz to store its data next to the exe.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const src = join(root, 'release', 'win-unpacked');
if (!existsSync(join(src, 'MindHz.exe'))) {
  console.error('release/win-unpacked/MindHz.exe not found — run electron-builder first');
  process.exit(1);
}
const folder = `MindHz-${version}`;
const stage = join(root, 'release', 'portable-stage');
const out = join(root, 'release', `MindHz-Portable-${version}.zip`);
rmSync(stage, { recursive: true, force: true });
rmSync(out, { force: true });
cpSync(src, join(stage, folder), { recursive: true });
writeFileSync(
  join(stage, folder, 'portable.txt'),
  [
    'MindHz — портативная версия / portable edition',
    '',
    'RU: Запускайте MindHz.exe. Установка и права администратора не нужны.',
    '    Настройки и пресеты хранятся в папке MindHz-Data рядом с MindHz.exe —',
    '    папку можно переносить на флешке. Если папка недоступна для записи',
    '    (например, внутри Program Files), данные сохраняются в %APPDATA%\\MindHz.',
    '    Удалите этот файл, чтобы хранить данные в профиле пользователя.',
    '',
    'EN: Run MindHz.exe. No installation or administrator rights required.',
    '    Settings and presets are stored in the MindHz-Data folder next to',
    '    MindHz.exe. If that folder is not writable, data goes to %APPDATA%\\MindHz.',
    '    Delete this file to store data in the user profile instead.',
    '',
  ].join('\r\n'),
);
// Windows 10+ ships bsdtar, which writes ZIP archives with -a; elsewhere use zip(1).
const r =
  process.platform === 'win32'
    ? spawnSync('tar', ['-a', '-c', '-f', out, folder], { cwd: stage, stdio: 'inherit' })
    : spawnSync('zip', ['-qr', '-9', out, folder], { cwd: stage, stdio: 'inherit' });
if (r.status !== 0) {
  console.error('zip failed');
  process.exit(1);
}
rmSync(stage, { recursive: true, force: true });
console.log(`created ${out}`);
