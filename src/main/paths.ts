/**
 * Data location policy.
 *
 *  Installed build:  %APPDATA%\MindHz           (kept on update and on uninstall by default)
 *  Portable build:   <folder of MindHz.exe>\MindHz-Data   (detected by the marker file
 *                    `portable.txt` shipped in the portable ZIP). If that folder is not
 *                    writable (e.g. unpacked into Program Files), MindHz falls back to
 *                    %APPDATA%\MindHz and tells the user.
 *  Smoke test:       <smoke dir>/userdata (isolated)
 */
import { accessSync, constants, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface DataLocation {
  dir: string | null; // null = Electron default userData
  portable: boolean;
  portableFallback: boolean;
}

function writable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.write-test-${process.pid}`);
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveDataLocation(
  execPath: string,
  isPackaged: boolean,
  smokeDir: string | null,
  explicitDir: string | null = null,
): DataLocation {
  if (explicitDir) return { dir: explicitDir, portable: false, portableFallback: false };
  if (smokeDir) return { dir: join(smokeDir, 'userdata'), portable: false, portableFallback: false };
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || dirname(execPath);
  const marker = join(exeDir, 'portable.txt');
  if (isPackaged && existsSync(marker)) {
    const dir = join(exeDir, 'MindHz-Data');
    if (writable(dir)) return { dir, portable: true, portableFallback: false };
    return { dir: null, portable: true, portableFallback: true };
  }
  return { dir: null, portable: false, portableFallback: false };
}

export function parseSmokeArg(argv: string[]): string | null {
  const a = argv.find((x) => x.startsWith('--smoke-test'));
  if (!a) return null;
  const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : '';
  return v || join(process.cwd(), 'smoke-output');
}

/** --data-dir=<path>: use an explicit data folder (development, testing, multiple profiles). */
export function parseDataDirArg(argv: string[]): string | null {
  const a = argv.find((x) => x.startsWith('--data-dir='));
  return a ? a.slice('--data-dir='.length) || null : null;
}
