import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { renderSession } from '../src/shared/audio/engine';
import { decodeFlac } from '../src/shared/export/flac';
import { md5Hex } from '../src/shared/export/md5';
import { type RenderOptions, finiteSession, renderToSink } from '../src/shared/export/render';
import { readWav } from '../src/shared/export/wav';
import { SR, makeLayer, oneStage } from './helpers';

class MemSink {
  private chunks: Uint8Array[] = [];
  private len = 0;
  write(b: Uint8Array) {
    this.chunks.push(b.slice());
    this.len += b.length;
  }
  patch(offset: number, b: Uint8Array) {
    const all = this.bytes();
    all.set(b, offset);
    this.chunks = [all];
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

async function exportBytes(session: ReturnType<typeof oneStage>, o: RenderOptions): Promise<Uint8Array> {
  const sink = new MemSink();
  await renderToSink(session, o, sink);
  return sink.bytes();
}

const session = oneStage(
  [
    makeLayer('binaural', { id: 'b', carrierHz: 200, beatHz: 8, volume: 0.7 }),
    makeLayer('noise', { id: 'n', noiseColor: 'pink', volume: 0.3 }),
    makeLayer('isochronic', { id: 'i', carrierHz: 330, beatHz: 6, volume: 0.4 }),
  ],
  3,
  { fadeInSec: 0.5, fadeOutSec: 0.5 },
);

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('export matches playback', () => {
  it('32-bit float WAV is sample-identical to the live engine', async () => {
    const bytes = await exportBytes(session, { format: 'wav', sampleRate: SR, bitDepth: 32, channels: 2 });
    const wav = readWav(bytes);
    const live = renderSession(session, SR, 128); // worklet-sized blocks
    assert.equal(wav.sampleRate, SR);
    assert.equal(wav.channels, 2);
    assert.equal(wav.data[0].length, live.left.length);
    assert.deepEqual(wav.data[0], live.left);
    assert.deepEqual(wav.data[1], live.right);
  });

  it('16/24-bit WAV differs from playback only by quantisation', async () => {
    const live = renderSession(session, SR, 128);
    for (const bitDepth of [16, 24] as const) {
      const wav = readWav(await exportBytes(session, { format: 'wav', sampleRate: SR, bitDepth, channels: 2 }));
      const lsb = 1 / (2 ** (bitDepth - 1) - 1);
      let maxErr = 0;
      for (let i = 0; i < live.left.length; i++) maxErr = Math.max(maxErr, Math.abs(wav.data[0][i] - live.left[i]));
      assert.ok(maxErr <= lsb * 1.6, `${bitDepth}-bit max error ${maxErr}`);
    }
  });

  it('mono export is the average of both channels', async () => {
    const wav = readWav(await exportBytes(session, { format: 'wav', sampleRate: SR, bitDepth: 32, channels: 1 }));
    const live = renderSession(session, SR);
    assert.equal(wav.channels, 1);
    assert.ok(Math.abs(wav.data[0][5000] - (live.left[5000] + live.right[5000]) / 2) < 1e-7);
  });
});

describe('FLAC', () => {
  for (const bitDepth of [16, 24] as const) {
    for (const sampleRate of [44100, 48000, 96000]) {
      it(`${bitDepth}-bit / ${sampleRate} Hz decodes bit-exactly to the same PCM as WAV`, async () => {
        const s = { ...session, stages: [{ ...session.stages[0], durationSec: 1.37 }] };
        const flac = decodeFlac(
          await exportBytes(s, { format: 'flac', sampleRate, bitDepth, channels: 2 }),
        );
        const wav = readWav(await exportBytes(s, { format: 'wav', sampleRate, bitDepth, channels: 2 }));
        const scale = 2 ** (bitDepth - 1) - 1;
        assert.equal(flac.sampleRate, sampleRate);
        assert.equal(flac.totalFrames, wav.data[0].length);
        for (let c = 0; c < 2; c++)
          for (let i = 0; i < flac.totalFrames; i++)
            assert.equal(flac.data[c][i], Math.round(wav.data[c][i] * scale), `ch${c} sample ${i}`);
        // STREAMINFO MD5 matches the decoded audio
        const bps = bitDepth / 8;
        const raw = new Uint8Array(flac.totalFrames * 2 * bps);
        let o = 0;
        for (let i = 0; i < flac.totalFrames; i++)
          for (let c = 0; c < 2; c++) {
            const v = flac.data[c][i];
            for (let b = 0; b < bps; b++) raw[o++] = (v >> (8 * b)) & 0xff;
          }
        assert.equal(Array.from(flac.md5, (b) => b.toString(16).padStart(2, '0')).join(''), md5Hex(raw));
      });
    }
  }

  it('compresses smaller than WAV', async () => {
    const o = { sampleRate: SR, bitDepth: 16 as const, channels: 2 as const };
    const f = await exportBytes(session, { ...o, format: 'flac' });
    const w = await exportBytes(session, { ...o, format: 'wav' });
    assert.ok(f.length < w.length * 0.9, `flac ${f.length} vs wav ${w.length}`);
  });

  it('is accepted by ffmpeg (if installed)', { skip: !hasFfmpeg }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindhz-'));
    try {
      const file = join(dir, 't.flac');
      writeFileSync(file, await exportBytes(session, { format: 'flac', sampleRate: SR, bitDepth: 24, channels: 2 }));
      const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's32le', '-acodec', 'pcm_s32le', join(dir, 'o.raw')]);
      assert.equal(r.status, 0, r.stderr.toString());
      const raw = new Int32Array(readFileSync(join(dir, 'o.raw')).buffer.slice(0));
      const wav = readWav(await exportBytes(session, { format: 'wav', sampleRate: SR, bitDepth: 24, channels: 2 }));
      for (let i = 0; i < 2000; i++) assert.equal(raw[i * 2] >> 8, Math.round(wav.data[0][i] * 8388607));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('continuous sessions', () => {
  it('are made finite with the requested duration', () => {
    const s = finiteSession({ ...session, loop: true }, 120, { in: 3, out: 4 });
    assert.equal(s.loop, false);
    assert.equal(s.stages.reduce((a, x) => a + x.durationSec, 0), 120);
    assert.equal(s.fadeOutSec, 4);
  });
});
