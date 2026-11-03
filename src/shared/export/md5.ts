/** Streaming MD5 (RFC 1321), used for the FLAC STREAMINFO audio signature. */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6,
  10, 15, 21,
];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;

export class Md5 {
  private h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
  private block = new Uint8Array(64);
  private blockLen = 0;
  private total = 0;
  private readonly w = new Int32Array(16);

  update(data: Uint8Array): void {
    this.total += data.length;
    let i = 0;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, data.length);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      i = take;
      if (this.blockLen === 64) {
        this.compress(this.block, 0);
        this.blockLen = 0;
      }
    }
    for (; i + 64 <= data.length; i += 64) this.compress(data, i);
    if (i < data.length) {
      this.block.set(data.subarray(i), 0);
      this.blockLen = data.length - i;
    }
  }

  private compress(b: Uint8Array, o: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = o + i * 4;
      w[i] = b[j] | (b[j + 1] << 8) | (b[j + 2] << 16) | (b[j + 3] << 24);
    }
    let [a, bb, c, d] = this.h;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (bb & c) | (~bb & d);
        g = i;
      } else if (i < 32) {
        f = (d & bb) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = bb ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (bb | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = bb;
      const x = (a + f + K[i] + w[g]) | 0;
      bb = (bb + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
      a = tmp;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + bb) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
  }

  digest(): Uint8Array {
    const bitLen = this.total * 8;
    const pad = new Uint8Array(((this.blockLen < 56 ? 56 : 120) - this.blockLen) + 8);
    pad[0] = 0x80;
    const lo = bitLen >>> 0;
    const hi = Math.floor(bitLen / 2 ** 32) >>> 0;
    const p = pad.length - 8;
    for (let i = 0; i < 4; i++) {
      pad[p + i] = (lo >>> (8 * i)) & 0xff;
      pad[p + 4 + i] = (hi >>> (8 * i)) & 0xff;
    }
    const total = this.total;
    this.update(pad);
    this.total = total;
    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out[i * 4 + j] = (this.h[i] >>> (8 * j)) & 0xff;
    return out;
  }
}

export function md5Hex(data: Uint8Array): string {
  const m = new Md5();
  m.update(data);
  return Array.from(m.digest(), (b) => b.toString(16).padStart(2, '0')).join('');
}
