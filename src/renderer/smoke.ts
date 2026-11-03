/**
 * Self-test executed by the packaged app when started with --smoke-test.
 * Exercises the real pipeline inside the real Electron runtime:
 *   phase 1: AudioWorklet engine (offline render, bit-compared with the engine),
 *            real-time AudioContext, WAV + FLAC export through the worker and the
 *            main-process file writer, settings + preset persistence;
 *   phase 2: (second launch) settings and presets were restored.
 * The external script scripts/smoke.ts then decodes the exported files.
 */
import { renderSession } from '../shared/audio/engine';
import { BUILTIN_PRESETS } from '../shared/catalog/presets';
import { finiteSession } from '../shared/export/render';
import { makeLayer, makeSession, makeStage } from '../shared/model';
import { api } from './api';
import { startExport } from './audio/exporter';
import { app, flushPersistence, saveUserSession, updateSettings } from './state/app';

interface Check {
  name: string;
  ok: boolean;
  fatal: boolean;
  detail?: unknown;
}

function zcFreq(x: Float32Array, sr: number, from: number, to: number): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const tt = i - 1 + -x[i - 1] / (x[i] - x[i - 1]);
      if (first < 0) first = tt;
      else count++;
      last = tt;
    }
  }
  return (count * sr) / (last - first);
}

const firstNonZero = (x: Float32Array) => x.findIndex((v) => Math.abs(v) > 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function offlineWorklet(): Promise<Check> {
  const sr = 48000;
  const session = makeSession({
    id: 'smoke',
    fadeInSec: 0.1,
    fadeOutSec: 0.1,
    stages: [makeStage({ durationSec: 2, layers: [makeLayer('binaural', { id: 'b', carrierHz: 200, beatHz: 10, volume: 1 })] })],
  });
  const ctx = new OfflineAudioContext(2, sr * 3, sr);
  await ctx.audioWorklet.addModule('worklet.js');
  const node = new AudioWorkletNode(ctx, 'mindhz-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  node.connect(ctx.destination);
  node.port.postMessage({ type: 'master', volume: 1, immediate: true });
  node.port.postMessage({ type: 'load', session, autoplay: true });
  await sleep(50);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const k = firstNonZero(L);
  const ref = renderSession(session, sr, 128);
  const j = firstNonZero(ref.left);
  let maxDiff = 0;
  for (let i = 0; i < sr; i++) maxDiff = Math.max(maxDiff, Math.abs(L[k + i] - ref.left[j + i]), Math.abs(R[k + i] - ref.right[j + i]));
  const fl = zcFreq(L, sr, k + sr * 0.3, k + sr * 1.6);
  const fr = zcFreq(R, sr, k + sr * 0.3, k + sr * 1.6);
  const ok = k >= 0 && Math.abs(fl - 195) < 0.01 && Math.abs(fr - 205) < 0.01 && maxDiff < 1e-6;
  return { name: 'worklet-offline-render', ok, fatal: true, detail: { leftHz: fl, rightHz: fr, maxDiffVsEngine: maxDiff, startOffset: k } };
}

async function realtime(): Promise<Check> {
  try {
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule('worklet.js');
    const node = new AudioWorkletNode(ctx, 'mindhz-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(ctx.destination);
    let last: { state: string; position: number; peakL: number } | null = null;
    node.port.onmessage = (e) => {
      if (e.data?.type === 'status') last = e.data;
    };
    await ctx.resume();
    node.port.postMessage({ type: 'master', volume: 0.05, immediate: true });
    node.port.postMessage({ type: 'load', session: BUILTIN_PRESETS[0], autoplay: true });
    await sleep(1500);
    const status = last as { state: string; position: number; peakL: number } | null;
    node.port.postMessage({ type: 'stop', fade: 0.05 });
    await sleep(200);
    await ctx.close();
    const ok = !!status && status.state === 'playing' && status.position > 0.5 && status.peakL > 0;
    return {
      name: 'realtime-playback',
      ok,
      // a CI machine may have no audio device; the offline check covers the engine
      fatal: false,
      detail: { contextState: ctx.state, sampleRate: ctx.sampleRate, status },
    };
  } catch (e) {
    return { name: 'realtime-playback', ok: false, fatal: false, detail: String(e) };
  }
}

async function exportCheck(format: 'wav' | 'flac', bitDepth: 16 | 24): Promise<Check> {
  try {
    const s = finiteSession(BUILTIN_PRESETS.find((p) => p.id === 'builtin-relax')!, 3, { in: 0.5, out: 0.5 });
    const job = startExport(s, { format, sampleRate: 44100, bitDepth, channels: 2 }, `smoke-${format}`, () => undefined);
    const r = await job.promise;
    return { name: `export-${format}`, ok: !!r && r.bytes > 1000, fatal: true, detail: r };
  } catch (e) {
    return { name: `export-${format}`, ok: false, fatal: true, detail: String(e) };
  }
}

export async function runSmoke(phase: number): Promise<void> {
  const checks: Check[] = [];
  try {
    checks.push({ name: 'ui-rendered', ok: !!document.querySelector('.shell .player'), fatal: true });
    if (phase === 1) {
      checks.push(await offlineWorklet());
      checks.push(await realtime());
      checks.push(await exportCheck('wav', 16));
      checks.push(await exportCheck('flac', 24));
      updateSettings({ theme: 'light', masterVolume: 0.234, safetyAccepted: true });
      saveUserSession(makeSession({ id: 'smoke-session', name: 'Smoke session' }));
      await flushPersistence();
      checks.push({ name: 'settings-saved', ok: true, fatal: true });
    } else {
      const st = app.get();
      checks.push({
        name: 'settings-restored',
        ok: st.settings.theme === 'light' && Math.abs(st.settings.masterVolume - 0.234) < 1e-9 && st.settings.safetyAccepted,
        fatal: true,
        detail: { theme: st.settings.theme, masterVolume: st.settings.masterVolume },
      });
      checks.push({
        name: 'preset-restored',
        ok: st.library.sessions.some((s) => s.id === 'smoke-session' && s.name === 'Smoke session'),
        fatal: true,
      });
    }
  } catch (e) {
    checks.push({ name: 'exception', ok: false, fatal: true, detail: String(e) });
  }
  const ok = checks.every((c) => c.ok || !c.fatal);
  await api.smokeReport({ ok, phase, version: app.get().info?.version, platform: app.get().info?.platform, checks });
}
