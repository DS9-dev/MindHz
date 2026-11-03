/**
 * MindHz synthesis engine.
 *
 * One deterministic implementation drives both the real-time AudioWorklet and the
 * offline exporter, so an exported file is sample-identical to what the player
 * produces with the same settings (at master volume 1).
 *
 * Determinism rules:
 *  - parameters are re-evaluated on a fixed 128-sample grid, independent of the
 *    caller's buffer size;
 *  - noise generators are seeded from the layer id;
 *  - no Date/Math.random inside the render path.
 *
 * Level safety:
 *  - every voice produces samples bounded to [-1, 1] per channel;
 *  - per-voice gain targets are normalised so their sum is <= 1 and all gains share
 *    the same one-pole smoother, so the smoothed sum also stays <= 1;
 *  - the mix is scaled by HEADROOM (-1 dBFS) and hard-limited as a last resort.
 *  The output therefore cannot clip, no matter how many layers are stacked.
 */
import type { Layer, LayerKind, NoiseColor, Session, Stage } from '../types';
import { NoiseGen, TWO_PI, clamp1, cosRamp, hashString, isoGate, onePole, smoothstep } from './dsp';

export const BLOCK = 128;
/** -1 dBFS */
export const HEADROOM = 0.8912509381337456;
/** Minimum fade / transition length used for click protection. */
export const MIN_EDGE_SEC = 0.03;

export interface VoiceTarget {
  key: string;
  kind: LayerKind;
  noiseColor: NoiseColor;
  seed: number;
  gain: number;
  carrierHz: number;
  beatHz: number;
  depth: number;
  duty: number;
  pan: number;
}

export interface TargetSet {
  targets: VoiceTarget[];
  /** Targets stay valid until this time (seconds). */
  validUntil: number;
  stageIndex: number;
}

const voiceKey = (l: Layer): string => `${l.id}|${l.kind}|${l.kind === 'noise' ? l.noiseColor : ''}`;

function layerTarget(l: Layer, gain: number): VoiceTarget {
  return {
    key: voiceKey(l),
    kind: l.kind,
    noiseColor: l.noiseColor,
    seed: hashString(l.id),
    gain,
    carrierHz: l.carrierHz,
    beatHz: l.beatHz,
    depth: l.depth,
    duty: l.duty,
    pan: l.pan,
  };
}

const lerp = (a: number, b: number, x: number): number => a + (b - a) * x;
const glerp = (a: number, b: number, x: number): number =>
  a > 0 && b > 0 ? a * Math.pow(b / a, x) : lerp(a, b, x);

export function transitionLength(stage: Stage): number {
  if (stage.transition === 'instant') return Math.min(MIN_EDGE_SEC, stage.durationSec);
  return Math.min(Math.max(MIN_EDGE_SEC, stage.transitionSec), stage.durationSec);
}

/** Locate the stage active at time t (seconds). Holds the last stage past the end. */
export function locateStage(session: Session, t: number): { index: number; start: number } {
  let start = 0;
  const n = session.stages.length;
  for (let i = 0; i < n; i++) {
    const d = session.stages[i].durationSec;
    if (t < start + d) return { index: i, start };
    start += d;
  }
  const last = n - 1;
  return { index: last, start: start - (last >= 0 ? session.stages[last].durationSec : 0) };
}

/** Pure function: which voices should sound at time t, with which parameters. */
export function computeTargets(session: Session, t: number): TargetSet {
  const stages = session.stages;
  if (stages.length === 0) return { targets: [], validUntil: Infinity, stageIndex: -1 };
  const { index, start } = locateStage(session, t);
  const stage = stages[index];
  const local = t - start;
  const out: VoiceTarget[] = [];
  const isLast = index === stages.length - 1;

  if (index > 0) {
    const tr = transitionLength(stage);
    if (local < tr) {
      const x = smoothstep(local / tr);
      const prev = stages[index - 1];
      const prevByKey = new Map<string, Layer>();
      for (const l of prev.layers) if (l.enabled) prevByKey.set(voiceKey(l), l);
      for (const l of stage.layers) {
        if (!l.enabled) continue;
        const k = voiceKey(l);
        const p = prevByKey.get(k);
        if (p) {
          prevByKey.delete(k);
          out.push({
            key: k,
            kind: l.kind,
            noiseColor: l.noiseColor,
            seed: hashString(l.id),
            gain: lerp(p.volume * prev.volume, l.volume * stage.volume, x),
            carrierHz: glerp(p.carrierHz, l.carrierHz, x),
            beatHz: glerp(p.beatHz, l.beatHz, x),
            depth: lerp(p.depth, l.depth, x),
            duty: lerp(p.duty, l.duty, x),
            pan: lerp(p.pan, l.pan, x),
          });
        } else {
          out.push(layerTarget(l, l.volume * stage.volume * x));
        }
      }
      for (const p of prevByKey.values()) out.push(layerTarget(p, p.volume * prev.volume * (1 - x)));
      // re-evaluate on every block while morphing
      return { targets: out, validUntil: t, stageIndex: index };
    }
  }
  for (const l of stage.layers) if (l.enabled) out.push(layerTarget(l, l.volume * stage.volume));
  return {
    targets: out,
    validUntil: isLast ? Infinity : start + stage.durationSec,
    stageIndex: index,
  };
}

class Voice {
  readonly key: string;
  readonly kind: LayerKind;
  readonly noiseColor: NoiseColor;
  g = 0;
  tg = 0;
  c: number;
  tc: number;
  b: number;
  tb: number;
  d: number;
  td: number;
  du: number;
  tdu: number;
  pan: number;
  tpan: number;
  p1 = 0;
  p2 = 0;
  pm = 0;
  private nL: NoiseGen | null = null;
  private nR: NoiseGen | null = null;
  outL = 0;
  outR = 0;

  constructor(t: VoiceTarget) {
    this.key = t.key;
    this.kind = t.kind;
    this.noiseColor = t.noiseColor;
    this.c = this.tc = t.carrierHz;
    this.b = this.tb = t.beatHz;
    this.d = this.td = t.depth;
    this.du = this.tdu = t.duty;
    this.pan = this.tpan = t.pan;
    if (t.kind === 'noise') {
      this.nL = new NoiseGen(t.seed ^ 0x51ed270b);
      this.nR = new NoiseGen(t.seed ^ 0x2c1b3c6d);
    }
  }

  setTarget(t: VoiceTarget, nyq: number): void {
    this.tg = t.gain;
    this.tc = Math.min(Math.max(t.carrierHz, 0), nyq);
    this.tb = Math.min(Math.max(t.beatHz, 0), 200);
    this.td = Math.min(Math.max(t.depth, 0), 1);
    this.tdu = Math.min(Math.max(t.duty, 0.05), 0.95);
    this.tpan = Math.min(Math.max(t.pan, -1), 1);
  }

  private noise(gen: NoiseGen): number {
    switch (this.noiseColor) {
      case 'white':
        return gen.white();
      case 'brown':
        return gen.brownNoise();
      default:
        return gen.pink();
    }
  }

  tick(invSr: number, aG: number, aF: number, aP: number): void {
    this.g += (this.tg - this.g) * aG;
    this.c += (this.tc - this.c) * aF;
    this.b += (this.tb - this.b) * aF;
    this.d += (this.td - this.d) * aP;
    this.du += (this.tdu - this.du) * aP;
    this.pan += (this.tpan - this.pan) * aP;

    let s = 0;
    let l = 0;
    let r = 0;
    let panned = true;
    switch (this.kind) {
      case 'tone': {
        s = Math.sin(TWO_PI * this.p1);
        this.p1 += this.c * invSr;
        break;
      }
      case 'binaural': {
        l = Math.sin(TWO_PI * this.p1);
        r = Math.sin(TWO_PI * this.p2);
        const half = this.b * 0.5;
        this.p1 += Math.max(0, this.c - half) * invSr;
        this.p2 += (this.c + half) * invSr;
        panned = false;
        break;
      }
      case 'monaural': {
        s = 0.5 * (Math.sin(TWO_PI * this.p1) + Math.sin(TWO_PI * this.p2));
        const half = this.b * 0.5;
        this.p1 += Math.max(0, this.c - half) * invSr;
        this.p2 += (this.c + half) * invSr;
        break;
      }
      case 'isochronic': {
        const gate = isoGate(this.pm, this.du);
        s = Math.sin(TWO_PI * this.p1) * (1 - this.d + this.d * gate);
        this.p1 += this.c * invSr;
        this.pm += this.b * invSr;
        break;
      }
      case 'am': {
        const mod = 0.5 - 0.5 * Math.cos(TWO_PI * this.pm);
        s = Math.sin(TWO_PI * this.p1) * (1 - this.d * (1 - mod));
        this.p1 += this.c * invSr;
        this.pm += this.b * invSr;
        break;
      }
      case 'noise': {
        l = this.noise(this.nL as NoiseGen);
        r = this.noise(this.nR as NoiseGen);
        break;
      }
    }
    if (this.p1 >= 1) this.p1 -= Math.floor(this.p1);
    if (this.p2 >= 1) this.p2 -= Math.floor(this.p2);
    if (this.pm >= 1) this.pm -= Math.floor(this.pm);

    if (this.kind !== 'binaural' && this.kind !== 'noise') {
      l = s;
      r = s;
    }
    if (panned) {
      // balance law: centre = full level on both sides, never above 1
      const p = this.pan;
      l *= p > 0 ? 1 - p : 1;
      r *= p < 0 ? 1 + p : 1;
    }
    this.outL = l * this.g;
    this.outR = r * this.g;
  }
}

export type TransportState = 'stopped' | 'playing' | 'pausing' | 'paused' | 'stopping' | 'ended';

export interface EngineStatus {
  state: TransportState;
  positionSec: number;
  durationSec: number;
  stageIndex: number;
  loop: boolean;
}

export class SynthEngine {
  readonly sampleRate: number;
  private readonly invSr: number;
  private readonly nyq: number;
  private readonly aG: number;
  private readonly aF: number;
  private readonly aP: number;
  private readonly aM: number;

  private session: Session | null = null;
  private totalSamples = 0;
  private fadeInS = 0;
  private fadeOutS = 0;
  private pos = 0;
  private stageIndex = -1;

  private voices = new Map<string, Voice>();
  private voiceList: Voice[] = [];
  private validUntilS = -1;
  private dirty = true;

  private master = 1;
  private tMaster = 1;
  private state: TransportState = 'stopped';
  private tGain = 1;
  private tStep = 0;

  private readonly bufL = new Float32Array(BLOCK);
  private readonly bufR = new Float32Array(BLOCK);
  private bufIdx = BLOCK;

  private peakL = 0;
  private peakR = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.invSr = 1 / sampleRate;
    this.nyq = sampleRate * 0.45;
    this.aG = onePole(0.012, sampleRate);
    this.aF = onePole(0.06, sampleRate);
    this.aP = onePole(0.03, sampleRate);
    this.aM = onePole(0.03, sampleRate);
  }

  /**
   * Load a session. With keepPosition the playhead and running voices are kept so
   * live edits glide smoothly to the new parameters.
   */
  setSession(session: Session | null, keepPosition = false): void {
    this.session = session;
    const sr = this.sampleRate;
    let total = 0;
    if (session) for (const st of session.stages) total += st.durationSec;
    this.totalSamples = Math.round(total * sr);
    let fi = Math.max(MIN_EDGE_SEC, session?.fadeInSec ?? 0);
    let fo = Math.max(MIN_EDGE_SEC, session?.fadeOutSec ?? 0);
    if (!session?.loop && fi + fo > total && total > 0) {
      const k = total / (fi + fo);
      fi *= k;
      fo *= k;
    }
    this.fadeInS = fi * sr;
    this.fadeOutS = fo * sr;
    this.dirty = true;
    if (!keepPosition) {
      this.pos = 0;
      this.voices.clear();
      this.voiceList = [];
      this.bufIdx = BLOCK;
    } else if (!session?.loop && this.pos >= this.totalSamples && this.state === 'playing') {
      this.state = 'ended';
    }
  }

  getSession(): Session | null {
    return this.session;
  }

  setMasterVolume(v: number, immediate = false): void {
    this.tMaster = Math.min(1, Math.max(0, v));
    if (immediate) this.master = this.tMaster;
  }

  play(): void {
    if (!this.session) return;
    if (this.state === 'paused' || this.state === 'pausing') {
      this.state = 'playing';
      this.ramp(1, 0.05);
      return;
    }
    if (this.state === 'playing') return;
    // fresh start: the session fade-in provides the click-free start, so the
    // transport gain starts at 1 (keeps playback identical to export)
    this.pos = 0;
    this.voices.clear();
    this.voiceList = [];
    this.bufIdx = BLOCK;
    this.dirty = true;
    this.tGain = 1;
    this.tStep = 0;
    this.state = 'playing';
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'pausing';
    this.ramp(0, 0.05);
  }

  /** Stop with a fade (seconds). Used by the stop button and the sleep timer. */
  stop(fadeSec = 0.25): void {
    if (this.state === 'stopped' || this.state === 'ended') {
      this.state = 'stopped';
      return;
    }
    if (this.state === 'paused') {
      this.reset();
      return;
    }
    this.state = 'stopping';
    this.ramp(0, Math.max(0.02, fadeSec));
  }

  private reset(): void {
    this.state = 'stopped';
    this.pos = 0;
    this.voices.clear();
    this.voiceList = [];
    this.bufIdx = BLOCK;
    this.dirty = true;
    this.tGain = 1;
    this.tStep = 0;
  }

  private ramp(target: number, sec: number): void {
    const n = Math.max(1, Math.round(sec * this.sampleRate));
    this.tStep = (target - this.tGain) / n;
    if (this.tStep === 0) this.onRampDone();
  }

  private onRampDone(): void {
    this.tStep = 0;
    if (this.state === 'pausing') this.state = 'paused';
    else if (this.state === 'stopping') this.reset();
  }

  status(): EngineStatus {
    return {
      state: this.state,
      positionSec: this.pos * this.invSr,
      durationSec: this.totalSamples * this.invSr,
      stageIndex: this.stageIndex,
      loop: !!this.session?.loop,
    };
  }

  /** Peak levels since the previous call (linear, 0..1). */
  takePeaks(): [number, number] {
    const p: [number, number] = [this.peakL, this.peakR];
    this.peakL = 0;
    this.peakR = 0;
    return p;
  }

  get isSounding(): boolean {
    return this.state === 'playing' || this.state === 'pausing' || this.state === 'stopping';
  }

  /** Render n samples into the given channel buffers (any n, any offset). */
  process(outL: Float32Array, outR: Float32Array, n = outL.length, offset = 0): void {
    let i = 0;
    while (i < n) {
      if (this.bufIdx >= BLOCK) {
        if (!this.isSounding) {
          // idle: output silence without advancing the render grid
          outL.fill(0, offset + i, offset + n);
          outR.fill(0, offset + i, offset + n);
          return;
        }
        this.renderBlock();
        this.bufIdx = 0;
      }
      const take = Math.min(n - i, BLOCK - this.bufIdx);
      outL.set(this.bufL.subarray(this.bufIdx, this.bufIdx + take), offset + i);
      outR.set(this.bufR.subarray(this.bufIdx, this.bufIdx + take), offset + i);
      this.bufIdx += take;
      i += take;
    }
  }

  private updateTargets(): void {
    const session = this.session as Session;
    const t = this.pos * this.invSr;
    const set = computeTargets(session, t);
    this.stageIndex = set.stageIndex;
    let sum = 0;
    for (const tg of set.targets) sum += tg.gain;
    const norm = sum > 1 ? 1 / sum : 1;
    for (const v of this.voiceList) v.tg = 0;
    let changed = false;
    for (const tg of set.targets) {
      tg.gain *= norm;
      let v = this.voices.get(tg.key);
      if (!v) {
        v = new Voice(tg);
        this.voices.set(tg.key, v);
        changed = true;
      }
      v.setTarget(tg, this.nyq);
    }
    if (changed) this.voiceList = Array.from(this.voices.values());
    this.validUntilS = set.validUntil === Infinity ? Infinity : Math.floor(set.validUntil * this.sampleRate);
    this.dirty = false;
  }

  private renderBlock(): void {
    const L = this.bufL;
    const R = this.bufR;
    const session = this.session;
    if (!session || session.stages.length === 0) {
      L.fill(0);
      R.fill(0);
      return;
    }
    if (this.dirty || this.pos >= this.validUntilS) this.updateTargets();

    const loop = session.loop;
    const total = this.totalSamples;
    const fi = this.fadeInS;
    const fo = this.fadeOutS;
    const aG = this.aG;
    const aF = this.aF;
    const aP = this.aP;
    const invSr = this.invSr;
    const voices = this.voiceList;
    const nv = voices.length;
    let pkL = this.peakL;
    let pkR = this.peakR;

    for (let i = 0; i < BLOCK; i++) {
      if (!this.isSounding || (!loop && this.pos >= total)) {
        L[i] = 0;
        R[i] = 0;
        if (!loop && this.pos >= total && this.isSounding) this.state = 'ended';
        continue;
      }
      const p = this.pos;
      let env = p < fi ? cosRamp(p / fi) : 1;
      if (!loop) {
        const rem = total - p;
        if (rem < fo) env *= cosRamp(rem / fo);
      }
      if (this.tStep !== 0) {
        this.tGain += this.tStep;
        if ((this.tStep > 0 && this.tGain >= 1) || (this.tStep < 0 && this.tGain <= 0)) {
          this.tGain = this.tStep > 0 ? 1 : 0;
          this.onRampDone();
        }
      }
      this.master += (this.tMaster - this.master) * this.aM;

      let sl = 0;
      let sr = 0;
      for (let v = 0; v < nv; v++) {
        const voice = voices[v];
        voice.tick(invSr, aG, aF, aP);
        sl += voice.outL;
        sr += voice.outR;
      }
      const g = env * this.tGain * this.master * HEADROOM;
      const yl = clamp1(sl * g);
      const yr = clamp1(sr * g);
      L[i] = yl;
      R[i] = yr;
      const al = yl < 0 ? -yl : yl;
      const ar = yr < 0 ? -yr : yr;
      if (al > pkL) pkL = al;
      if (ar > pkR) pkR = ar;
      if (this.state === 'stopped') {
        // stop ramp completed inside this block
        for (let j = i + 1; j < BLOCK; j++) {
          L[j] = 0;
          R[j] = 0;
        }
        break;
      }
      this.pos++;
    }
    this.peakL = pkL;
    this.peakR = pkR;

    // drop voices that have fully faded out
    let removed = false;
    for (const v of voices) {
      if (v.tg === 0 && v.g < 1e-6) {
        this.voices.delete(v.key);
        removed = true;
      }
    }
    if (removed) this.voiceList = Array.from(this.voices.values());
  }
}

/** Convenience for tests and export: render a whole (finite) session. */
export function renderSession(
  session: Session,
  sampleRate: number,
  chunk = 4096,
): { left: Float32Array; right: Float32Array } {
  const total = Math.round(session.stages.reduce((a, s) => a + s.durationSec, 0) * sampleRate);
  const eng = new SynthEngine(sampleRate);
  eng.setSession({ ...session, loop: false });
  eng.setMasterVolume(1, true);
  eng.play();
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let off = 0; off < total; off += chunk) {
    const n = Math.min(chunk, total - off);
    eng.process(left, right, n, off);
  }
  return { left, right };
}
