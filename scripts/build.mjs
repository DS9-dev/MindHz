// Build script: bundles main, preload, renderer, AudioWorklet and export worker
// with esbuild. Output in dist/. Usage: node scripts/build.mjs [--dev] [--watch]
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dev = args.has('--dev') || args.has('--watch');
const watch = args.has('--watch');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'renderer'), { recursive: true });

const common = {
  bundle: true,
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  logLevel: 'info',
  legalComments: 'none',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
  },
};

const builds = [
  {
    ...common,
    entryPoints: [join(root, 'src/main/main.ts')],
    outfile: join(out, 'main/main.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  },
  {
    ...common,
    entryPoints: [join(root, 'src/preload/preload.ts')],
    outfile: join(out, 'preload/preload.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  },
  {
    ...common,
    entryPoints: { app: join(root, 'src/renderer/main.tsx') },
    outdir: join(out, 'renderer'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    jsx: 'automatic',
    loader: { '.svg': 'text' },
  },
  {
    ...common,
    entryPoints: { worklet: join(root, 'src/renderer/audio/worklet.ts') },
    outdir: join(out, 'renderer'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  },
  {
    ...common,
    entryPoints: { 'export-worker': join(root, 'src/renderer/audio/export.worker.ts') },
    outdir: join(out, 'renderer'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  },
];

cpSync(join(root, 'src/renderer/index.html'), join(out, 'renderer/index.html'));
cpSync(join(root, 'build/icon.svg'), join(out, 'renderer/icon.svg'));

if (watch) {
  for (const b of builds) {
    const ctx = await esbuild.context(b);
    await ctx.watch();
  }
  console.log('watching… (restart Electron or press Ctrl+R in the window after changes)');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log(`built MindHz ${pkg.version} (${dev ? 'development' : 'production'})`);
}
