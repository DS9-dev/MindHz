/**
 * Offline render + encode pipeline. Runs in a Web Worker in the app (so the UI never
 * blocks) and directly in Node for the automated tests. Uses exactly the same
 * SynthEngine as live playback.
 */
import { SynthEngine } from '../audio/engine';
import { sessionDuration } from '../model';
import type { ExportFormat, Session } from '../types';
import { FlacEncoder } from './flac';
import { toChannels } from './pcm';
import { type AudioEncoder, WavEncoder } from './wav';

export interface RenderOptions {
  format: ExportFormat;
  sampleRate: number;
  bitDepth: 16 | 24 | 32;
  channels: 1 | 2;
}

export interface ByteSink {
  write(bytes: Uint8Array): Promise<void> | void;
  patch(offset: number, bytes: Uint8Array): Promise<void> | void;
}

export function makeEncoder(o: RenderOptions, totalFrames: number): AudioEncoder {
  if (o.format === 'flac') {
    return new FlacEncoder({
      sampleRate: o.sampleRate,
      channels: o.channels,
      bitDepth: o.bitDepth === 32 ? 24 : o.bitDepth,
      totalFrames,
    });
  }
  return new WavEncoder({ sampleRate: o.sampleRate, channels: o.channels, bitDepth: o.bitDepth, totalFrames });
}

/**
 * Prepare a session for export: continuous sessions become finite (the given
 * duration is applied to the last stage, which is the one that would be held).
 */
export function finiteSession(session: Session, durationSec?: number, fades?: { in: number; out: number }): Session {
  const s: Session = JSON.parse(JSON.stringify(session));
  if (fades) {
    s.fadeInSec = fades.in;
    s.fadeOutSec = fades.out;
  }
  if (durationSec && durationSec > 0) {
    const total = sessionDuration(s);
    if (s.loop || Math.abs(total - durationSec) > 1e-6) {
      const last = s.stages[s.stages.length - 1];
      const others = total - last.durationSec;
      if (durationSec > others) last.durationSec = durationSec - others;
      else {
        // shorter than the programme: truncate stages
        let acc = 0;
        const keep = [];
        for (const st of s.stages) {
          if (acc >= durationSec) break;
          const d = Math.min(st.durationSec, durationSec - acc);
          keep.push({ ...st, durationSec: d });
          acc += d;
        }
        s.stages = keep;
      }
    }
  }
  s.loop = false;
  return s;
}

export async function renderToSink(
  session: Session,
  o: RenderOptions,
  sink: ByteSink,
  onProgress?: (fraction: number) => void,
  isCancelled?: () => boolean,
): Promise<{ frames: number; bytes: number }> {
  const s = { ...session, loop: false };
  const totalFrames = Math.round(sessionDuration(s) * o.sampleRate);
  const engine = new SynthEngine(o.sampleRate);
  engine.setSession(s);
  engine.setMasterVolume(1, true);
  engine.play();
  const enc = makeEncoder(o, totalFrames);
  let bytes = 0;
  const head = enc.header();
  await sink.write(head);
  bytes += head.length;
  const CH = o.sampleRate; // one second per chunk
  const L = new Float32Array(CH);
  const R = new Float32Array(CH);
  let done = 0;
  let lastReport = 0;
  while (done < totalFrames) {
    if (isCancelled?.()) throw new Error('CANCELLED');
    const n = Math.min(CH, totalFrames - done);
    engine.process(L, R, n, 0);
    const chunk = enc.encode(toChannels(L, R, n, o.channels));
    if (chunk.length) {
      await sink.write(chunk);
      bytes += chunk.length;
    }
    done += n;
    if (onProgress && (done - lastReport >= o.sampleRate * 5 || done === totalFrames)) {
      lastReport = done;
      onProgress(done / totalFrames);
    }
  }
  const fin = enc.finish();
  if (fin.tail.length) {
    await sink.write(fin.tail);
    bytes += fin.tail.length;
  }
  for (const p of fin.patches) await sink.patch(p.offset, p.bytes);
  return { frames: totalFrames, bytes };
}

/** Estimated output size in bytes (FLAC is an approximation). */
export function estimateBytes(o: RenderOptions, seconds: number): number {
  const frames = seconds * o.sampleRate;
  const raw = frames * o.channels * (o.bitDepth / 8);
  return o.format === 'flac' ? raw * 0.55 : raw + 64;
}
