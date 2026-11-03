/**
 * End-to-end smoke test of a built MindHz executable (installed, portable or unpacked).
 *
 *   npm run smoke -- --exe "release/win-unpacked/MindHz.exe" --out smoke-output [--keep-data]
 *   npm run smoke -- --exe node_modules/.bin/electron --app .      (development build)
 *
 * Launch 1 (--smoke-phase=1): engine via AudioWorklet, real-time playback, WAV + FLAC
 *   export through the real worker/IPC/file pipeline, settings + preset save.
 * Launch 2 (--smoke-phase=2): settings and preset are restored after restart.
 * Then this script decodes the exported files with the reference decoders and checks
 * format, length, level and the binaural channel difference.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeFlac } from '../src/shared/export/flac';
import { readWav } from '../src/shared/export/wav';

const args = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const exe = arg('--exe');
const out = resolve(arg('--out', 'smoke-output')!);
const extra = process.platform === 'linux' ? ['--no-sandbox'] : [];
if (!exe || !existsSync(exe)) {
  console.error(`executable not found: ${exe}`);
  process.exit(2);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

function launch(phase: number): { ok: boolean; checks: { name: string; ok: boolean; fatal: boolean; detail?: unknown }[] } {
  const appArgs = arg('--app') ? [arg('--app')!] : []; // when --exe is a bare electron binary
  const r = spawnSync(exe!, [...appArgs, ...extra, `--smoke-test=${out}`, `--smoke-phase=${phase}`], {
    encoding: 'utf8',
    timeout: 150_000,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
  });
  const reportPath = resolve(out, 'smoke-report.json');
  if (!existsSync(reportPath)) {
    console.error(r.stdout, r.stderr);
    throw new Error(`phase ${phase}: no report (exit ${r.status}, signal ${r.signal})`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  rmSync(reportPath);
  for (const c of report.checks) console.log(`  [${c.ok ? 'ok' : c.fatal ? 'FAIL' : 'warn'}] ${c.name}${c.ok ? '' : ` ${JSON.stringify(c.detail)}`}`);
  if (r.status !== (report.ok ? 0 : 1)) console.warn(`  exit code ${r.status}`);
  return report;
}

let failed = false;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`  [${ok ? 'ok' : 'FAIL'}] ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failed = true;
};

console.log(`MindHz smoke test: ${exe}`);
console.log('phase 1 (first launch)');
const p1 = launch(1);
if (!p1.ok) failed = true;
console.log('phase 2 (restart)');
const p2 = launch(2);
if (!p2.ok) failed = true;

console.log('exported files');
try {
  const wav = readWav(new Uint8Array(readFileSync(resolve(out, 'smoke-wav.wav'))));
  check('wav: 44.1 kHz / 16-bit / stereo', wav.sampleRate === 44100 && wav.bitDepth === 16 && wav.channels === 2, wav);
  check('wav: 3 s long', wav.data[0].length === 44100 * 3, wav.data[0].length);
  let peak = 0;
  let diff = 0;
  for (let i = 0; i < wav.data[0].length; i++) {
    peak = Math.max(peak, Math.abs(wav.data[0][i]), Math.abs(wav.data[1][i]));
    diff = Math.max(diff, Math.abs(wav.data[0][i] - wav.data[1][i]));
  }
  check('wav: audible and below 0 dBFS', peak > 0.05 && peak < 0.9, peak);
  check('wav: binaural channels differ', diff > 0.01, diff);
  const flac = decodeFlac(new Uint8Array(readFileSync(resolve(out, 'smoke-flac.flac'))));
  check('flac: decodes with valid CRCs, 24-bit stereo', flac.bitDepth === 24 && flac.channels === 2 && flac.totalFrames === 44100 * 3, {
    bitDepth: flac.bitDepth,
    frames: flac.totalFrames,
  });
} catch (e) {
  check('exported files readable', false, String(e));
}

if (!args.includes('--keep-data')) rmSync(resolve(out, 'userdata'), { recursive: true, force: true });
console.log(failed ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
process.exit(failed ? 1 : 0);
