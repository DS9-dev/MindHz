import type { Layer, LayerKind, Session, Stage } from './types';

/** Hard parameter limits enforced everywhere (UI, import, engine). */
export const LIMITS = {
  carrierMin: 1,
  carrierMax: 20000,
  beatMin: 0.1,
  beatMax: 100,
  stageMinSec: 1,
  stageMaxSec: 6 * 3600,
  transitionMaxSec: 600,
  fadeMaxSec: 600,
  maxLayers: 8,
  maxStages: 64,
} as const;

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  const rnd = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${rnd}`;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

const KIND_DEFAULTS: Record<LayerKind, Partial<Layer>> = {
  tone: { carrierHz: 432, beatHz: 0, volume: 0.6 },
  binaural: { carrierHz: 200, beatHz: 10, volume: 0.6 },
  monaural: { carrierHz: 200, beatHz: 10, volume: 0.6 },
  isochronic: { carrierHz: 220, beatHz: 10, depth: 1, duty: 0.5, volume: 0.55 },
  am: { carrierHz: 250, beatHz: 10, depth: 0.8, volume: 0.6 },
  noise: { noiseColor: 'pink', volume: 0.35 },
};

export function makeLayer(kind: LayerKind, patch: Partial<Layer> = {}): Layer {
  return {
    id: uid('layer'),
    kind,
    enabled: true,
    volume: 0.6,
    pan: 0,
    carrierHz: 200,
    beatHz: 10,
    depth: 0.8,
    duty: 0.5,
    noiseColor: 'pink',
    ...KIND_DEFAULTS[kind],
    ...patch,
  };
}

export function makeStage(patch: Partial<Stage> = {}): Stage {
  return {
    id: uid('stage'),
    name: 'Этап',
    durationSec: 600,
    transitionSec: 20,
    transition: 'smooth',
    volume: 1,
    layers: [],
    ...patch,
  };
}

export function makeSession(patch: Partial<Session> = {}): Session {
  return {
    id: uid('session'),
    name: 'Новый сеанс',
    stages: [makeStage({ name: 'Этап 1', layers: [makeLayer('binaural')] })],
    fadeInSec: 5,
    fadeOutSec: 8,
    loop: false,
    ...patch,
  };
}

export function sessionDuration(s: Session): number {
  let t = 0;
  for (const st of s.stages) t += st.durationSec;
  return t;
}

/** Deep clone with fresh ids (used for duplicate / "edit a copy"). */
export function cloneSession(s: Session, patch: Partial<Session> = {}): Session {
  const copy: Session = JSON.parse(JSON.stringify(s));
  copy.id = uid('session');
  copy.builtin = false;
  copy.stages = copy.stages.map((st) => ({
    ...st,
    id: uid('stage'),
    // layer ids are kept identical across stages on purpose: matching ids are what
    // makes the engine morph a layer smoothly instead of cross-fading it.
  }));
  const now = Date.now();
  copy.createdAt = now;
  copy.updatedAt = now;
  return { ...copy, ...patch };
}

export const needsHeadphones = (layers: Layer[]): boolean =>
  layers.some((l) => l.enabled && l.kind === 'binaural');

export const KIND_ORDER: LayerKind[] = ['binaural', 'isochronic', 'monaural', 'am', 'tone', 'noise'];
