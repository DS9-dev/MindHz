import { Quantizer } from './pcm';

export interface AudioEncoder {
  /** Bytes to write first. */
  header(): Uint8Array;
  /** Encode a chunk of planar samples (1 or 2 channels). */
  encode(channels: Float32Array[]): Uint8Array;
  /** Flush; may return trailing bytes and in-place patches for the header. */
  finish(): { tail: Uint8Array; patches: { offset: number; bytes: Uint8Array }[] };
  readonly extension: string;
}

export interface WavOptions {
  sampleRate: number;
  channels: 1 | 2;
  bitDepth: 16 | 24 | 32; // 32 = IEEE float
  totalFrames: number;
}

/** WAV can't exceed 4 GiB (32-bit RIFF size field). */
export function wavByteSize(o: Omit<WavOptions, 'sampleRate'> & { sampleRate?: number }): number {
  const fmtExtra = o.bitDepth === 32 ? 12 : 0; // fact chunk
  return 44 + fmtExtra + o.totalFrames * o.channels * (o.bitDepth / 8);
}

export const WAV_MAX_BYTES = 0xffffffff;

export class WavEncoder implements AudioEncoder {
  readonly extension = 'wav';
  private readonly o: WavOptions;
  private readonly qs: Quantizer[];
  constructor(o: WavOptions) {
    this.o = o;
    this.qs = Array.from({ length: o.channels }, (_, c) => new Quantizer(o.bitDepth, 0x6d696e64 + c * 7919));
    if (wavByteSize(o) > WAV_MAX_BYTES) throw new Error('WAV_TOO_LARGE');
  }

  header(): Uint8Array {
    const { sampleRate, channels, bitDepth, totalFrames } = this.o;
    const isFloat = bitDepth === 32;
    const bytesPerSample = bitDepth / 8;
    const dataBytes = totalFrames * channels * bytesPerSample;
    const headerLen = isFloat ? 58 : 44;
    const buf = new ArrayBuffer(headerLen);
    const v = new DataView(buf);
    const str = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    v.setUint32(4, headerLen - 8 + dataBytes, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, isFloat ? 18 : 16, true);
    v.setUint16(20, isFloat ? 3 : 1, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * channels * bytesPerSample, true);
    v.setUint16(32, channels * bytesPerSample, true);
    v.setUint16(34, bitDepth, true);
    let off = 36;
    if (isFloat) {
      v.setUint16(36, 0, true); // cbSize
      str(38, 'fact');
      v.setUint32(42, 4, true);
      v.setUint32(46, totalFrames, true);
      off = 50;
    }
    str(off, 'data');
    v.setUint32(off + 4, dataBytes, true);
    return new Uint8Array(buf);
  }

  encode(ch: Float32Array[]): Uint8Array {
    const n = ch[0].length;
    const nc = ch.length;
    const bd = this.o.bitDepth;
    const out = new Uint8Array(n * nc * (bd / 8));
    const v = new DataView(out.buffer);
    let o = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nc; c++) {
        const x = ch[c][i];
        if (bd === 32) {
          v.setFloat32(o, x, true);
          o += 4;
        } else if (bd === 16) {
          v.setInt16(o, this.qs[c].q(x), true);
          o += 2;
        } else {
          const s = this.qs[c].q(x);
          out[o] = s & 0xff;
          out[o + 1] = (s >> 8) & 0xff;
          out[o + 2] = (s >> 16) & 0xff;
          o += 3;
        }
      }
    }
    return out;
  }

  finish() {
    return { tail: new Uint8Array(0), patches: [] };
  }
}

/** Minimal WAV reader used by tests and the smoke check. */
export function readWav(bytes: Uint8Array): {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: number;
  data: Float32Array[];
} {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12;
  let fmt = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bitDepth = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      const bps = bitDepth / 8;
      const frames = Math.floor(size / (bps * channels));
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      let p = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
          let x: number;
          if (fmt === 3) x = v.getFloat32(p, true);
          else if (bitDepth === 16) x = v.getInt16(p, true) / 32767;
          else {
            let s = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
            if (s & 0x800000) s -= 0x1000000;
            x = s / 8388607;
          }
          data[c][i] = x;
          p += bps;
        }
      }
      return { sampleRate, channels, bitDepth, format: fmt, data };
    }
    off = body + size + (size & 1);
  }
  throw new Error('WAV data chunk not found');
}
