/**
 * Self-contained streaming FLAC encoder (no native code, no external libraries).
 *
 * Uses fixed linear predictors (orders 0..4) with partitioned Rice coding and
 * mid/side or left/side stereo decorrelation — the same toolset as `flac -0`..`-2`.
 * The output is a standard FLAC stream with STREAMINFO (incl. MD5) and a
 * VORBIS_COMMENT block, decodable by any FLAC player.
 */
import { BitReader, BitWriter, crc16, crc8 } from './bits';
import { Md5 } from './md5';
import { Quantizer } from './pcm';
import type { AudioEncoder } from './wav';

export interface FlacOptions {
  sampleRate: number;
  channels: 1 | 2;
  bitDepth: 16 | 24;
  totalFrames: number;
  blockSize?: number;
  vendor?: string;
}

const SR_CODES: Record<number, number> = {
  88200: 1,
  176400: 2,
  192000: 3,
  8000: 4,
  16000: 5,
  22050: 6,
  24000: 7,
  32000: 8,
  44100: 9,
  48000: 10,
  96000: 11,
};
const BPS_CODES: Record<number, number> = { 8: 1, 12: 2, 16: 4, 20: 5, 24: 6 };

function utf8Number(w: BitWriter, v: number): void {
  if (v < 0x80) return w.write(v, 8);
  let bytes: number;
  if (v < 0x800) bytes = 2;
  else if (v < 0x10000) bytes = 3;
  else if (v < 0x200000) bytes = 4;
  else if (v < 0x4000000) bytes = 5;
  else bytes = 6;
  const lead = (0xff << (8 - bytes)) & 0xff;
  const shift = (bytes - 1) * 6;
  w.write(lead | Math.floor(v / 2 ** shift), 8);
  for (let i = bytes - 2; i >= 0; i--) w.write(0x80 | (Math.floor(v / 2 ** (i * 6)) & 0x3f), 8);
}

interface SubframePlan {
  type: 'constant' | 'verbatim' | 'fixed';
  order: number;
  bits: number; // estimated size
}

/** Residual of a fixed predictor of given order (length n - order). */
function fixedResidual(x: Int32Array, n: number, order: number, out: Int32Array): void {
  switch (order) {
    case 0:
      for (let i = 0; i < n; i++) out[i] = x[i];
      break;
    case 1:
      for (let i = 1; i < n; i++) out[i - 1] = x[i] - x[i - 1];
      break;
    case 2:
      for (let i = 2; i < n; i++) out[i - 2] = x[i] - 2 * x[i - 1] + x[i - 2];
      break;
    case 3:
      for (let i = 3; i < n; i++) out[i - 3] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3];
      break;
    case 4:
      for (let i = 4; i < n; i++) out[i - 4] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
      break;
  }
}

interface RicePlan {
  order: number;
  params: number[];
  rice2: boolean;
  bits: number;
}

function bestParam(sum: number, count: number, maxK: number): { k: number; bits: number } {
  let best = Infinity;
  let bk = 0;
  for (let k = 0; k <= maxK; k++) {
    const est = count * (k + 1) + Math.floor(sum / 2 ** k);
    if (est < best) {
      best = est;
      bk = k;
    }
    if (2 ** k > sum) break;
  }
  return { k: bk, bits: best };
}

/** Choose the partition order and Rice parameters for a residual. */
function planRice(res: Int32Array, len: number, n: number, predOrder: number): RicePlan {
  let maxPo = 0;
  while (maxPo < 8 && n % (1 << (maxPo + 1)) === 0 && n >> (maxPo + 1) > predOrder) maxPo++;
  const parts = 1 << maxPo;
  const psize = n >> maxPo;
  const sums = new Float64Array(parts);
  const counts = new Float64Array(parts);
  for (let p = 0; p < parts; p++) {
    const start = p === 0 ? 0 : p * psize - predOrder;
    const end = (p + 1) * psize - predOrder;
    let s = 0;
    for (let i = start; i < end && i < len; i++) {
      const r = res[i];
      s += r >= 0 ? 2 * r : -2 * r - 1;
    }
    sums[p] = s;
    counts[p] = end - start;
  }
  let best: RicePlan | null = null;
  let curSums = sums;
  let curCounts = counts;
  for (let po = maxPo; po >= 0; po--) {
    const np = 1 << po;
    if (po < maxPo) {
      const ns = new Float64Array(np);
      const nc = new Float64Array(np);
      for (let p = 0; p < np; p++) {
        ns[p] = curSums[2 * p] + curSums[2 * p + 1];
        nc[p] = curCounts[2 * p] + curCounts[2 * p + 1];
      }
      curSums = ns;
      curCounts = nc;
    }
    const params: number[] = [];
    let bits = 6;
    let rice2 = false;
    for (let p = 0; p < np; p++) {
      const r = bestParam(curSums[p], curCounts[p], 30);
      params.push(r.k);
      bits += r.bits;
      if (r.k > 14) rice2 = true;
    }
    bits += np * (rice2 ? 5 : 4);
    if (!best || bits < best.bits) best = { order: po, params, rice2, bits };
  }
  return best as RicePlan;
}

export class FlacEncoder implements AudioEncoder {
  readonly extension = 'flac';
  private readonly o: Required<FlacOptions>;
  private readonly qs: Quantizer[];
  private readonly pending: Int32Array[];
  private pendingLen = 0;
  private frameNo = 0;
  private bytesWritten = 0;
  private minFrame = Infinity;
  private maxFrame = 0;
  private readonly md5 = new Md5();
  private readonly res: Int32Array;
  private readonly side: Int32Array;
  private readonly mid: Int32Array;
  private headerLen = 0;

  constructor(o: FlacOptions) {
    this.o = { blockSize: 4096, vendor: 'MindHz FLAC encoder', ...o };
    const bs = this.o.blockSize;
    this.qs = Array.from({ length: o.channels }, (_, c) => new Quantizer(o.bitDepth, 0x6d696e64 + c * 7919));
    this.pending = Array.from({ length: o.channels }, () => new Int32Array(bs));
    this.res = new Int32Array(bs);
    this.side = new Int32Array(bs);
    this.mid = new Int32Array(bs);
  }

  header(): Uint8Array {
    const { sampleRate, channels, bitDepth, totalFrames, blockSize, vendor } = this.o;
    const w = new BitWriter(256);
    w.write(0x664c6143, 32); // "fLaC"
    // STREAMINFO
    w.write(0, 1);
    w.write(0, 7);
    w.write(34, 24);
    const bsMin = totalFrames > 0 && totalFrames < blockSize ? totalFrames : blockSize;
    w.write(bsMin, 16);
    w.write(bsMin, 16);
    w.write(0, 24); // min frame size (patched)
    w.write(0, 24); // max frame size (patched)
    w.write(sampleRate, 20);
    w.write(channels - 1, 3);
    w.write(bitDepth - 1, 5);
    w.writeBig(totalFrames, 36);
    for (let i = 0; i < 4; i++) w.write(0, 32); // MD5 (patched)
    // VORBIS_COMMENT (last metadata block)
    const enc = new TextEncoder();
    const vend = enc.encode(vendor);
    const comment = enc.encode('ENCODER=MindHz');
    const vcLen = 4 + vend.length + 4 + 4 + comment.length;
    w.write(1, 1);
    w.write(4, 7);
    w.write(vcLen, 24);
    const le32 = (v: number) => {
      w.write(v & 0xff, 8);
      w.write((v >>> 8) & 0xff, 8);
      w.write((v >>> 16) & 0xff, 8);
      w.write((v >>> 24) & 0xff, 8);
    };
    le32(vend.length);
    for (const b of vend) w.write(b, 8);
    le32(1);
    le32(comment.length);
    for (const b of comment) w.write(b, 8);
    const out = w.bytes().slice();
    this.headerLen = out.length;
    this.bytesWritten = out.length;
    return out;
  }

  encode(ch: Float32Array[]): Uint8Array {
    const n = ch[0].length;
    const bs = this.o.blockSize;
    const chunks: Uint8Array[] = [];
    let i = 0;
    while (i < n) {
      const take = Math.min(bs - this.pendingLen, n - i);
      for (let c = 0; c < this.o.channels; c++) {
        const dst = this.pending[c];
        const src = ch[c];
        const q = this.qs[c];
        for (let j = 0; j < take; j++) dst[this.pendingLen + j] = q.q(src[i + j]);
      }
      this.pendingLen += take;
      i += take;
      if (this.pendingLen === bs) chunks.push(this.flushFrame());
    }
    return concat(chunks);
  }

  finish() {
    const tail = this.pendingLen > 0 ? this.flushFrame() : new Uint8Array(0);
    // patch STREAMINFO min/max frame size and MD5
    const patch = new Uint8Array(6);
    const minF = this.minFrame === Infinity ? 0 : this.minFrame;
    patch[0] = (minF >> 16) & 0xff;
    patch[1] = (minF >> 8) & 0xff;
    patch[2] = minF & 0xff;
    patch[3] = (this.maxFrame >> 16) & 0xff;
    patch[4] = (this.maxFrame >> 8) & 0xff;
    patch[5] = this.maxFrame & 0xff;
    return {
      tail,
      patches: [
        { offset: 4 + 4 + 4, bytes: patch },
        { offset: 4 + 4 + 18, bytes: this.md5.digest() },
      ],
    };
  }

  private updateMd5(n: number): void {
    const nc = this.o.channels;
    const bpsB = this.o.bitDepth / 8;
    const buf = new Uint8Array(n * nc * bpsB);
    let o = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nc; c++) {
        const s = this.pending[c][i];
        buf[o++] = s & 0xff;
        buf[o++] = (s >> 8) & 0xff;
        if (bpsB === 3) buf[o++] = (s >> 16) & 0xff;
      }
    }
    this.md5.update(buf);
  }

  private flushFrame(): Uint8Array {
    const n = this.pendingLen;
    const { channels, bitDepth, sampleRate } = this.o;
    this.updateMd5(n);
    const w = new BitWriter(n * channels * 4 + 64);

    // stereo decorrelation choice
    let assignment = channels - 1; // independent
    let chans: { data: Int32Array; bps: number }[] = this.pending.map((d) => ({ data: d, bps: bitDepth }));
    if (channels === 2) {
      const L = this.pending[0];
      const R = this.pending[1];
      for (let i = 0; i < n; i++) {
        this.side[i] = L[i] - R[i];
        this.mid[i] = (L[i] + R[i]) >> 1;
      }
      const cost = (x: Int32Array) => this.planSubframe(x, n, bitDepth + 1).bits;
      const cL = this.planSubframe(L, n, bitDepth).bits;
      const cR = this.planSubframe(R, n, bitDepth).bits;
      const cS = cost(this.side);
      const cM = this.planSubframe(this.mid, n, bitDepth).bits;
      const options = [
        { a: 1, bits: cL + cR },
        { a: 8, bits: cL + cS },
        { a: 9, bits: cR + cS },
        { a: 10, bits: cM + cS },
      ];
      options.sort((x, y) => x.bits - y.bits);
      assignment = options[0].a;
      if (assignment === 8) chans = [{ data: L, bps: bitDepth }, { data: this.side, bps: bitDepth + 1 }];
      else if (assignment === 9) chans = [{ data: this.side, bps: bitDepth + 1 }, { data: R, bps: bitDepth }];
      else if (assignment === 10) chans = [{ data: this.mid, bps: bitDepth }, { data: this.side, bps: bitDepth + 1 }];
    }

    // frame header
    w.write(0x3ffe, 14);
    w.write(0, 1);
    w.write(0, 1);
    let bsCode: number;
    if (n === 4096) bsCode = 12;
    else if (n === 1152) bsCode = 2;
    else if (n <= 256) bsCode = 6;
    else bsCode = 7;
    w.write(bsCode, 4);
    w.write(SR_CODES[sampleRate] ?? 0, 4);
    w.write(assignment, 4);
    w.write(BPS_CODES[bitDepth], 3);
    w.write(0, 1);
    utf8Number(w, this.frameNo);
    if (bsCode === 6) w.write(n - 1, 8);
    else if (bsCode === 7) w.write(n - 1, 16);
    w.write(crc8(w.bytes()), 8);

    for (const c of chans) this.writeSubframe(w, c.data, n, c.bps);
    w.alignZero();
    const body = w.bytes();
    w.write(crc16(body), 16);
    const frame = w.bytes().slice();

    this.frameNo++;
    this.pendingLen = 0;
    this.bytesWritten += frame.length;
    if (frame.length < this.minFrame) this.minFrame = frame.length;
    if (frame.length > this.maxFrame) this.maxFrame = frame.length;
    return frame;
  }

  private planSubframe(x: Int32Array, n: number, bps: number): SubframePlan {
    let constant = true;
    for (let i = 1; i < n; i++)
      if (x[i] !== x[0]) {
        constant = false;
        break;
      }
    if (constant) return { type: 'constant', order: 0, bits: 8 + bps };
    let bestOrder = 0;
    let bestSum = Infinity;
    for (let order = 0; order <= 4 && order < n; order++) {
      fixedResidual(x, n, order, this.res);
      let s = 0;
      for (let i = 0; i < n - order; i++) s += Math.abs(this.res[i]);
      if (s < bestSum) {
        bestSum = s;
        bestOrder = order;
      }
    }
    fixedResidual(x, n, bestOrder, this.res);
    const plan = planRice(this.res, n - bestOrder, n, bestOrder);
    const fixedBits = 8 + bestOrder * bps + plan.bits;
    const verbatimBits = 8 + n * bps;
    if (verbatimBits <= fixedBits) return { type: 'verbatim', order: 0, bits: verbatimBits };
    return { type: 'fixed', order: bestOrder, bits: fixedBits };
  }

  private writeSubframe(w: BitWriter, x: Int32Array, n: number, bps: number): void {
    const plan = this.planSubframe(x, n, bps);
    w.write(0, 1);
    if (plan.type === 'constant') {
      w.write(0, 6);
      w.write(0, 1);
      w.writeSigned(x[0], bps);
      return;
    }
    if (plan.type === 'verbatim') {
      w.write(1, 6);
      w.write(0, 1);
      for (let i = 0; i < n; i++) w.writeSigned(x[i], bps);
      return;
    }
    const order = plan.order;
    w.write(8 + order, 6);
    w.write(0, 1);
    for (let i = 0; i < order; i++) w.writeSigned(x[i], bps);
    fixedResidual(x, n, order, this.res);
    const rp = planRice(this.res, n - order, n, order);
    w.write(rp.rice2 ? 1 : 0, 2);
    w.write(rp.order, 4);
    const parts = 1 << rp.order;
    const psize = n >> rp.order;
    const pbits = rp.rice2 ? 5 : 4;
    let idx = 0;
    for (let p = 0; p < parts; p++) {
      const k = rp.params[p];
      w.write(k, pbits);
      const count = p === 0 ? psize - order : psize;
      for (let j = 0; j < count; j++) {
        const r = this.res[idx++];
        const u = r >= 0 ? 2 * r : -2 * r - 1;
        const q = Math.floor(u / 2 ** k);
        w.writeUnary(q);
        if (k > 0) w.write(u - q * 2 ** k, k);
      }
    }
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Decoder for the subset produced above (constant / verbatim / fixed subframes,
 * any stereo mode). Verifies all CRCs. Used by the automated tests and the
 * packaged-app smoke check.
 */
export function decodeFlac(bytes: Uint8Array): {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  totalFrames: number;
  md5: Uint8Array;
  data: Int32Array[];
} {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'fLaC') throw new Error('not a FLAC stream');
  const r = new BitReader(bytes, 4);
  let sampleRate = 0;
  let channels = 0;
  let bitDepth = 0;
  let totalFrames = 0;
  let md5 = new Uint8Array(16);
  for (;;) {
    const last = r.read(1);
    const type = r.read(7);
    const len = r.read(24);
    const start = r.bytePos;
    if (type === 0) {
      r.read(16);
      r.read(16);
      r.read(24);
      r.read(24);
      sampleRate = r.read(20);
      channels = r.read(3) + 1;
      bitDepth = r.read(5) + 1;
      totalFrames = r.read(36);
      md5 = bytes.slice(r.bytePos, r.bytePos + 16);
    }
    r.bytePos = start + len;
    if (last) break;
  }
  const data = Array.from({ length: channels }, () => new Int32Array(totalFrames));
  let written = 0;
  while (written < totalFrames) {
    const frameStart = r.bytePos;
    if (r.read(14) !== 0x3ffe) throw new Error(`lost sync at byte ${frameStart}`);
    r.read(2);
    const bsCode = r.read(4);
    r.read(4);
    const assignment = r.read(4);
    r.read(3);
    r.read(1);
    // utf-8 frame number
    let first = r.read(8);
    let extra = 0;
    while (first & 0x80) {
      extra++;
      first = (first << 1) & 0xff;
    }
    for (let i = 1; i < extra; i++) r.read(8);
    let n: number;
    if (bsCode === 12) n = 4096;
    else if (bsCode === 2) n = 1152;
    else if (bsCode === 6) n = r.read(8) + 1;
    else if (bsCode === 7) n = r.read(16) + 1;
    else throw new Error(`unsupported block size code ${bsCode}`);
    const hdrEnd = r.bytePos;
    const c8 = r.read(8);
    if (c8 !== crc8(bytes, frameStart, hdrEnd)) throw new Error('frame header CRC mismatch');
    const nch = assignment < 8 ? assignment + 1 : 2;
    const sub: Int32Array[] = [];
    for (let c = 0; c < nch; c++) {
      const sideCh = (assignment === 8 && c === 1) || (assignment === 9 && c === 0) || (assignment === 10 && c === 1);
      const bps = bitDepth + (sideCh ? 1 : 0);
      sub.push(decodeSubframe(r, n, bps));
    }
    r.align();
    const bodyEnd = r.bytePos;
    const c16 = r.read(16);
    if (c16 !== crc16(bytes, frameStart, bodyEnd)) throw new Error('frame CRC mismatch');
    for (let i = 0; i < n; i++) {
      let a = sub[0][i];
      let b = nch > 1 ? sub[1][i] : 0;
      if (assignment === 8) b = a - b;
      else if (assignment === 9) a = a + b;
      else if (assignment === 10) {
        const side = b;
        const mid = a * 2 + (side & 1);
        a = (mid + side) >> 1;
        b = (mid - side) >> 1;
      }
      data[0][written + i] = a;
      if (nch > 1) data[1][written + i] = b;
    }
    written += n;
  }
  return { sampleRate, channels, bitDepth, totalFrames, md5, data };
}

function decodeSubframe(r: BitReader, n: number, bps: number): Int32Array {
  r.read(1);
  const type = r.read(6);
  if (r.read(1)) throw new Error('wasted bits not supported');
  const out = new Int32Array(n);
  if (type === 0) {
    out.fill(r.readSigned(bps));
    return out;
  }
  if (type === 1) {
    for (let i = 0; i < n; i++) out[i] = r.readSigned(bps);
    return out;
  }
  if (type < 8 || type > 12) throw new Error(`unsupported subframe type ${type}`);
  const order = type - 8;
  for (let i = 0; i < order; i++) out[i] = r.readSigned(bps);
  const method = r.read(2);
  const po = r.read(4);
  const parts = 1 << po;
  const psize = n >> po;
  const pbits = method === 1 ? 5 : 4;
  const res = new Int32Array(n - order);
  let idx = 0;
  for (let p = 0; p < parts; p++) {
    const k = r.read(pbits);
    const count = p === 0 ? psize - order : psize;
    for (let j = 0; j < count; j++) {
      const q = r.readUnary();
      const u = q * 2 ** k + (k ? r.read(k) : 0);
      res[idx++] = u % 2 === 0 ? u / 2 : -(u + 1) / 2;
    }
  }
  for (let i = order; i < n; i++) {
    const e = res[i - order];
    switch (order) {
      case 0:
        out[i] = e;
        break;
      case 1:
        out[i] = e + out[i - 1];
        break;
      case 2:
        out[i] = e + 2 * out[i - 1] - out[i - 2];
        break;
      case 3:
        out[i] = e + 3 * out[i - 1] - 3 * out[i - 2] + out[i - 3];
        break;
      case 4:
        out[i] = e + 4 * out[i - 1] - 6 * out[i - 2] + 4 * out[i - 3] - out[i - 4];
        break;
    }
  }
  return out;
}
