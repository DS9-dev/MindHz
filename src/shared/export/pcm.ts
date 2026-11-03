import { Rng } from '../audio/dsp';

/**
 * Float → integer PCM quantiser. 16-bit output uses TPDF dither (±1 LSB) from a
 * deterministic PRNG; 24-bit output is rounded (its noise floor is already far
 * below audibility).
 */
export class Quantizer {
  readonly bits: number;
  private readonly scale: number;
  private readonly max: number;
  private readonly min: number;
  private readonly rng: Rng | null;
  constructor(bits: number, seed = 0x6d696e64) {
    this.bits = bits;
    this.scale = 2 ** (bits - 1) - 1;
    this.max = 2 ** (bits - 1) - 1;
    this.min = -(2 ** (bits - 1));
    this.rng = bits <= 16 ? new Rng(seed) : null;
  }
  q(x: number): number {
    let v = x * this.scale;
    if (this.rng) v += (this.rng.next() + this.rng.next()) * 0.5;
    v = Math.round(v);
    return v > this.max ? this.max : v < this.min ? this.min : v;
  }
}

/** Optional down-mix to mono: (L+R)/2 — note: destroys binaural beats. */
export function toChannels(
  left: Float32Array,
  right: Float32Array,
  n: number,
  channels: 1 | 2,
): Float32Array[] {
  if (channels === 2) return [left.subarray(0, n), right.subarray(0, n)];
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = (left[i] + right[i]) * 0.5;
  return [m];
}
