// Development run: build with source maps, then start Electron with DevTools.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

await new Promise((res, rej) =>
  spawn(process.execPath, [join(root, 'scripts/build.mjs'), '--dev'], { stdio: 'inherit' }).on('exit', (c) =>
    c === 0 ? res() : rej(new Error('build failed')),
  ),
);
const electron = require('electron');
const child = spawn(electron, [root], { stdio: 'inherit', env: { ...process.env, MINDHZ_DEV: '1' } });
child.on('exit', (code) => process.exit(code ?? 0));
