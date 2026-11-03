/** Big-endian bit writer / reader used by the FLAC codec. */

export class BitWriter {
  private buf: Uint8Array;
  private len = 0;
  private cur = 0;
  private n = 0; // bits in cur

  constructor(initial = 1 << 16) {
    this.buf = new Uint8Array(initial);
  }

  private push(byte: number): void {
    if (this.len >= this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.len++] = byte;
  }

  /** Write `bits` (0..32) low bits of an unsigned value. */
  write(value: number, bits: number): void {
    while (bits > 0) {
      const take = Math.min(8 - this.n, bits);
      const shift = bits - take;
      const chunk = shift >= 32 ? 0 : (value >>> shift) & ((1 << take) - 1);
      this.cur = (this.cur << take) | chunk;
      this.n += take;
      bits -= take;
      if (this.n === 8) {
        this.push(this.cur);
        this.cur = 0;
        this.n = 0;
      }
    }
  }

  /** Write values wider than 32 bits (e.g. 36-bit sample counts). */
  writeBig(value: number, bits: number): void {
    if (bits <= 32) return this.write(value >>> 0, bits);
    const hi = Math.floor(value / 2 ** 32);
    this.write(hi, bits - 32);
    this.write(value >>> 0, 32);
  }

  writeSigned(value: number, bits: number): void {
    this.write(bits === 32 ? value >>> 0 : value & (2 ** bits - 1), bits);
  }

  /** q zero bits followed by a one bit. */
  writeUnary(q: number): void {
    while (q >= 24) {
      this.write(0, 24);
      q -= 24;
    }
    this.write(1, q + 1);
  }

  alignZero(): void {
    if (this.n > 0) this.write(0, 8 - this.n);
  }

  get byteLength(): number {
    return this.len;
  }

  get aligned(): boolean {
    return this.n === 0;
  }

  /** Bytes written so far (must be byte-aligned). */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

export class BitReader {
  private pos = 0; // bit position
  constructor(private readonly b: Uint8Array, startByte = 0) {
    this.pos = startByte * 8;
  }
  get bytePos(): number {
    return this.pos >> 3;
  }
  set bytePos(v: number) {
    this.pos = v * 8;
  }
  get eof(): boolean {
    return this.pos >= this.b.length * 8;
  }
  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.b[this.pos >> 3];
      if (byte === undefined) throw new Error('unexpected end of stream');
      const bit = (byte >> (7 - (this.pos & 7))) & 1;
      v = v * 2 + bit;
      this.pos++;
    }
    return v;
  }
  readSigned(bits: number): number {
    const v = this.read(bits);
    return v >= 2 ** (bits - 1) ? v - 2 ** bits : v;
  }
  readUnary(): number {
    let q = 0;
    while (this.read(1) === 0) q++;
    return q;
  }
  align(): void {
    this.pos = (this.pos + 7) & ~7;
  }
}

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  CRC8[i] = c;
  let d = i << 8;
  for (let j = 0; j < 8; j++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
  CRC16[i] = d;
}

export function crc8(b: Uint8Array, start = 0, end = b.length): number {
  let c = 0;
  for (let i = start; i < end; i++) c = CRC8[c ^ b[i]];
  return c;
}

export function crc16(b: Uint8Array, start = 0, end = b.length): number {
  let c = 0;
  for (let i = start; i < end; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]];
  return c;
}
