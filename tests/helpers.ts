import { makeLayer, makeSession, makeStage } from '../src/shared/model';
import type { Layer, Session } from '../src/shared/types';

export const SR = 48000;

/** Frequency of a (locally) pure sine via interpolated zero crossings. */
export function zeroCrossFreq(x: Float32Array, sr: number, from = 0, to = x.length): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const frac = -x[i - 1] / (x[i] - x[i - 1]);
      const t = i - 1 + frac;
      if (first < 0) first = t;
      else count++;
      last = t;
    }
  }
  return (count * sr) / (last - first);
}

/** Power of a signal at frequency f (Goertzel). */
export function goertzel(x: ArrayLike<number>, sr: number, f: number, from = 0, to = x.length): number {
  const w = (2 * Math.PI * f) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s0 = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

export function peak(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

export function maxStep(x: Float32Array, from = 1, to = x.length): number {
  let m = 0;
  for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
}

export function oneStage(layers: Layer[], seconds: number, extra: Partial<Session> = {}): Session {
  return makeSession({
    stages: [makeStage({ durationSec: seconds, layers })],
    fadeInSec: 0.2,
    fadeOutSec: 0.2,
    ...extra,
  });
}

export { makeLayer, makeSession, makeStage };
