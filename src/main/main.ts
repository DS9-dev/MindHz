/**
 * MindHz — Electron main process.
 *
 * Security model: the renderer is sandboxed, has no Node.js, runs with context
 * isolation and a strict CSP, is served from a private `app://` origin, may not
 * navigate or open windows, and talks to the system only through the small,
 * validated IPC surface defined in preload.ts.
 */
import { randomBytes } from 'node:crypto';
import { promises as fsp, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { release } from 'node:os';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { DEFAULT_LIBRARY, sanitizeLibrary, sanitizeSettings } from '../shared/schema';
import type { AppInfo, Library, Settings } from '../shared/types';
import { parseDataDirArg, parseSmokeArg, resolveDataLocation } from './paths';
import { JsonStore } from './store';

const smokeDir = parseSmokeArg(process.argv);
const isDev = !app.isPackaged && process.env.MINDHZ_DEV === '1';
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const winBuild = isWin ? Number(release().split('.')[2] ?? 0) : 0;
const micaSupported = isWin && winBuild >= 22000;

// ── data location (must happen before 'ready') ──────────────────────────────
const location = resolveDataLocation(process.execPath, app.isPackaged, smokeDir, parseDataDirArg(process.argv));
if (location.dir) {
  mkdirSync(location.dir, { recursive: true });
  app.setPath('userData', location.dir);
  app.setPath('sessionData', join(location.dir, 'session'));
}
app.setAppUserModelId('io.github.ds9dev.mindhz');

if (!smokeDir && !app.requestSingleInstanceLock()) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true },
  },
]);

const RENDERER_DIR = join(__dirname, '..', 'renderer');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// ── stores ───────────────────────────────────────────────────────────────────
let settingsStore: JsonStore<Settings>;
let libraryStore: JsonStore<Library>;
let settings: Settings;
let library: Library;
let win: BrowserWindow | null = null;
let powerBlockId: number | null = null;

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  const def: WindowState = { width: 1320, height: 860, maximized: false };
  try {
    const s = JSON.parse(readFileSync(windowStatePath(), 'utf8')) as WindowState;
    if (typeof s.width !== 'number' || typeof s.height !== 'number') return def;
    // only restore a position that is still on a connected display
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return s.x! >= a.x - 50 && s.y! >= a.y - 50 && s.x! < a.x + a.width - 100 && s.y! < a.y + a.height - 100;
      });
      if (!visible) {
        delete s.x;
        delete s.y;
      }
    }
    return { ...def, ...s, width: Math.max(900, s.width), height: Math.max(620, s.height) };
  } catch {
    return def;
  }
}

function saveWindowState(): void {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    writeFileSync(windowStatePath(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {
    /* non-critical */
  }
}

function effectiveDark(s: Settings): boolean {
  return s.theme === 'dark' || (s.theme === 'system' && nativeTheme.shouldUseDarkColors);
}

function chromeColors(dark: boolean, mica: boolean) {
  return {
    background: mica ? '#00000000' : dark ? '#0d0f15' : '#f3f4f8',
    overlay: { color: '#00000000', symbolColor: dark ? '#e7e9f0' : '#1b1e27', height: 44 },
  };
}

function applyAppearance(): void {
  nativeTheme.themeSource = settings.theme;
  if (!win || win.isDestroyed()) return;
  const dark = effectiveDark(settings);
  const mica = micaSupported && settings.mica;
  const c = chromeColors(dark, mica);
  if (micaSupported) win.setBackgroundMaterial(mica ? 'mica' : 'none');
  win.setBackgroundColor(c.background);
  if (!isMac) {
    try {
      win.setTitleBarOverlay(c.overlay);
    } catch {
      /* not available on this platform */
    }
  }
}

function createWindow(): void {
  const state = loadWindowState();
  const dark = effectiveDark(settings);
  const mica = micaSupported && settings.mica;
  const c = chromeColors(dark, mica);
  win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'MindHz',
    backgroundColor: c.background,
    ...(micaSupported ? { backgroundMaterial: mica ? 'mica' : 'none' } : {}),
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: c.overlay }),
    icon: process.platform === 'linux' ? join(__dirname, '..', '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged || process.env.MINDHZ_DEVTOOLS === '1',
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (!smokeDir) win?.show();
  });
  win.on('close', saveWindowState);
  win.on('closed', () => {
    win = null;
  });
  void win.loadURL('app://mindhz/index.html');
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
}

// ── hardening ────────────────────────────────────────────────────────────────
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://mindhz/')) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

function isSafeExternal(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function assertSender(e: IpcMainInvokeEvent): void {
  const url = e.senderFrame?.url ?? '';
  if (!url.startsWith('app://mindhz/')) throw new Error('IPC from untrusted origin');
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (e, ...args) => {
    assertSender(e);
    return fn(...(args as A));
  });
}

// ── export file I/O (renderer never sees or chooses raw paths) ──────────────
interface ExportHandle {
  path: string;
  tmp: string;
  fh: fsp.FileHandle;
  pos: number;
}
const exportsOpen = new Map<string, ExportHandle>();
const finishedExports = new Set<string>();

async function beginExport(name: string, format: string): Promise<{ token: string; fileName: string } | null> {
  if (format !== 'wav' && format !== 'flac') throw new Error('bad format');
  const safeName =
    basename(String(name))
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .slice(0, 120) || 'MindHz';
  let target: string;
  if (smokeDir) {
    target = join(smokeDir, `${safeName}.${format}`);
  } else {
    const r = await dialog.showSaveDialog(win!, {
      title: 'MindHz',
      defaultPath: join(app.getPath('music'), `${safeName}.${format}`),
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
    if (extname(target).toLowerCase() !== `.${format}`) target += `.${format}`;
  }
  const tmp = `${target}.part`;
  const fh = await fsp.open(tmp, 'w');
  const token = randomBytes(16).toString('hex');
  exportsOpen.set(token, { path: target, tmp, fh, pos: 0 });
  return { token, fileName: basename(target) };
}

function getExport(token: unknown): ExportHandle {
  const h = typeof token === 'string' ? exportsOpen.get(token) : undefined;
  if (!h) throw new Error('unknown export');
  return h;
}

const asBytes = (b: unknown): Uint8Array => {
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  throw new Error('bad buffer');
};

async function abortExport(token: string): Promise<void> {
  const h = exportsOpen.get(token);
  if (!h) return;
  exportsOpen.delete(token);
  await h.fh.close().catch(() => undefined);
  await fsp.rm(h.tmp, { force: true }).catch(() => undefined);
}

// ── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc(): void {
  handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    portable: location.portable && !location.portableFallback,
    dataPath: app.getPath('userData'),
    isPackaged: app.isPackaged,
    micaSupported,
    smokeTest: !!smokeDir,
    smokePhase: Number(process.argv.find((a) => a.startsWith('--smoke-phase='))?.split('=')[1] ?? 1),
  }));

  handle('store:load', () => ({
    settings,
    library,
    recovered: settingsStore.recoveredFrom || libraryStore.recoveredFrom,
    portableFallback: location.portableFallback,
  }));

  handle('store:saveSettings', async (v: unknown) => {
    const prev = settings;
    settings = sanitizeSettings(v);
    if (prev.theme !== settings.theme || prev.mica !== settings.mica) applyAppearance();
    await settingsStore.save(settings);
  });

  handle('store:saveLibrary', async (v: unknown) => {
    library = sanitizeLibrary(v);
    await libraryStore.save(library);
  });

  handle('store:resetAll', async () => {
    settings = sanitizeSettings(undefined);
    library = sanitizeLibrary(DEFAULT_LIBRARY);
    await settingsStore.save(settings);
    await libraryStore.save(library);
    applyAppearance();
  });

  handle('export:begin', (name: string, format: string) => beginExport(name, format));
  handle('export:write', async (token: string, bytes: unknown) => {
    const h = getExport(token);
    const b = asBytes(bytes);
    await h.fh.write(b, 0, b.length, h.pos);
    h.pos += b.length;
  });
  handle('export:patch', async (token: string, offset: number, bytes: unknown) => {
    const h = getExport(token);
    const b = asBytes(bytes);
    if (!Number.isInteger(offset) || offset < 0 || offset + b.length > h.pos) throw new Error('bad patch');
    await h.fh.write(b, 0, b.length, offset);
  });
  handle('export:finish', async (token: string) => {
    const h = getExport(token);
    exportsOpen.delete(token);
    await h.fh.sync();
    await h.fh.close();
    await fsp.rename(h.tmp, h.path);
    finishedExports.add(h.path);
    return { path: h.path, fileName: basename(h.path), bytes: h.pos };
  });
  handle('export:abort', (token: string) => abortExport(token));
  handle('export:reveal', (path: string) => {
    if (finishedExports.has(path)) shell.showItemInFolder(path);
  });

  handle('presets:save', async (json: string, name: string) => {
    if (typeof json !== 'string' || json.length > 20 * 1024 * 1024) throw new Error('bad data');
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: join(app.getPath('documents'), `${basename(String(name)).replace(/[^\p{L}\p{N} _.-]/gu, '_')}.mindhz.json`),
      filters: [{ name: 'MindHz', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    await fsp.writeFile(r.filePath, json, 'utf8');
    return true;
  });
  handle('presets:open', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'MindHz', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const st = await fsp.stat(r.filePaths[0]);
    if (st.size > 20 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
    return fsp.readFile(r.filePaths[0], 'utf8');
  });

  handle('app:openExternal', (url: string) => {
    if (isSafeExternal(url)) void shell.openExternal(url);
  });
  handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));
  handle('app:power', (playing: boolean) => {
    if (playing && powerBlockId === null) powerBlockId = powerSaveBlocker.start('prevent-app-suspension');
    if (!playing && powerBlockId !== null) {
      powerSaveBlocker.stop(powerBlockId);
      powerBlockId = null;
    }
  });

  handle('smoke:report', async (report: unknown) => {
    if (!smokeDir) return;
    const ok = typeof report === 'object' && report !== null && (report as { ok?: boolean }).ok === true;
    writeFileSync(join(smokeDir, 'smoke-report.json'), JSON.stringify(report, null, 2));
    console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'}`);
    console.log(JSON.stringify(report, null, 2));
    await settingsStore.idle();
    await libraryStore.idle();
    setTimeout(() => app.exit(ok ? 0 : 1), 50);
  });
}

// ── app:// protocol ──────────────────────────────────────────────────────────
function registerProtocol(): void {
  const root = resolve(RENDERER_DIR);
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'mindhz') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fsp.readFile(file);
      return new Response(body, {
        headers: {
          'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ── lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  settingsStore = new JsonStore(dataDir, 'settings.json', sanitizeSettings);
  libraryStore = new JsonStore(dataDir, 'library.json', sanitizeLibrary);
  settings = settingsStore.load();
  library = libraryStore.load();
  nativeTheme.themeSource = settings.theme;

  if (!isMac) Menu.setApplicationMenu(null);

  // Permissions: only what audio output needs; everything else is denied.
  const ses = session.defaultSession;
  const allowed = new Set(['speaker-selection', 'media']);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    cb(allowed.has(permission) && details.requestingUrl.startsWith('app://mindhz/') && permission !== 'media');
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && origin.startsWith('app://mindhz'));
  ses.setDevicePermissionHandler(() => false);

  registerProtocol();
  registerIpc();
  nativeTheme.on('updated', applyAppearance);
  createWindow();

  if (smokeDir) {
    // hard timeout so a hung renderer can never block CI
    setTimeout(() => {
      writeFileSync(join(smokeDir, 'smoke-report.json'), JSON.stringify({ ok: false, error: 'timeout' }));
      console.error('[smoke] FAIL: timeout');
      app.exit(2);
    }, 120_000).unref();
  }
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  saveWindowState();
  if (powerBlockId !== null) powerSaveBlocker.stop(powerBlockId);
  e.preventDefault();
  const tasks = [...exportsOpen.keys()].map((t) => abortExport(t));
  Promise.allSettled([...tasks, settingsStore?.idle(), libraryStore?.idle()]).finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  app.quit();
});

if (smokeDir && !existsSync(smokeDir)) mkdirSync(smokeDir, { recursive: true });
