/** Small, allocation-free DSP helpers shared by the engine. */

export const TWO_PI = Math.PI * 2;

/** One-pole smoothing coefficient for a time constant in seconds. */
export function onePole(tauSec: number, sampleRate: number): number {
  if (tauSec <= 0) return 1;
  return 1 - Math.exp(-1 / (tauSec * sampleRate));
}

/** Deterministic xorshift32 PRNG returning floats in [-1, 1). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 2147483648 - 1;
  }
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Coloured noise generator. All colours are scaled to a similar loudness and hard
 * bounded to [-1, 1] so the engine's headroom budget stays valid.
 */
export class NoiseGen {
  private rng: Rng;
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;
  private brown = 0;
  constructor(seed: number) {
    this.rng = new Rng(seed);
  }
  white(): number {
    return this.rng.next() * 0.5;
  }
  /** Paul Kellet's refined pink-noise filter (−3 dB/oct). */
  pink(): number {
    const w = this.rng.next();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const p = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return clamp1(p * 0.16);
  }
  /** Leaky-integrated white noise (−6 dB/oct, "brown"/"red"). */
  brownNoise(): number {
    const w = this.rng.next();
    this.brown = (this.brown + 0.02 * w) / 1.02;
    return clamp1(this.brown * 4.2);
  }
}

export function clamp1(x: number): number {
  return x > 1 ? 1 : x < -1 ? -1 : x;
}

/**
 * Isochronic gate: a periodic pulse with raised-cosine edges (no clicks).
 * phase in [0,1), duty in (0,1).
 */
export function isoGate(phase: number, duty: number): number {
  const e = Math.min(0.2, duty / 2, (1 - duty) / 2);
  if (phase < e) return 0.5 - 0.5 * Math.cos((Math.PI * phase) / e);
  if (phase < duty - e) return 1;
  if (phase < duty) return 0.5 + 0.5 * Math.cos((Math.PI * (phase - (duty - e))) / e);
  return 0;
}

export function smoothstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/** Raised-cosine 0→1 ramp. */
export function cosRamp(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}
