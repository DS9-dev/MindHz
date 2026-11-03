/**
 * Real-time playback: owns the AudioContext, the engine worklet and the analysers
 * used by the visualisations. UI components never touch Web Audio directly.
 */
import type { Session } from '../../shared/types';
import { createStore } from '../state/store';
import type { WorkletCommand, WorkletStatus } from './worklet';

export type PlayState = 'stopped' | 'playing' | 'pausing' | 'paused' | 'stopping' | 'ended';

export interface PlayerStatus {
  state: PlayState;
  position: number;
  duration: number;
  stageIndex: number;
  loop: boolean;
  peakL: number;
  peakR: number;
  sleepLeft: number | null;
  sampleRate: number;
  outputLatency: number;
  error: string | null;
}

export const playerStatus = createStore<PlayerStatus>({
  state: 'stopped',
  position: 0,
  duration: 0,
  stageIndex: -1,
  loop: false,
  peakL: 0,
  peakR: 0,
  sleepLeft: null,
  sampleRate: 0,
  outputLatency: 0,
  error: null,
});

const ENV_SECONDS = 4;
const ENV_RATE = 200;

class AudioService {
  ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  analyserL: AnalyserNode | null = null;
  analyserR: AnalyserNode | null = null;
  analyserMix: AnalyserNode | null = null;
  /** Ring buffer of the recent amplitude envelope for the envelope view. */
  readonly envelope = new Float32Array(ENV_SECONDS * ENV_RATE);
  envelopeHead = 0;
  private initPromise: Promise<void> | null = null;
  private opts = { sampleRate: 0, latency: 'playback' as AudioContextLatencyCategory, sinkId: '' };
  private suspendTimer: number | null = null;
  private onSleepFired: (() => void) | null = null;
  private onEnded: (() => void) | null = null;

  configure(o: { sampleRate: number; latency: AudioContextLatencyCategory; sinkId: string }): void {
    const needRebuild = this.ctx && (o.sampleRate !== this.opts.sampleRate || o.latency !== this.opts.latency);
    const sinkChanged = o.sinkId !== this.opts.sinkId;
    this.opts = { ...o };
    if (needRebuild) void this.dispose();
    else if (sinkChanged && this.ctx) void this.applySink();
  }

  setCallbacks(cb: { onSleepFired?: () => void; onEnded?: () => void }): void {
    this.onSleepFired = cb.onSleepFired ?? null;
    this.onEnded = cb.onEnded ?? null;
  }

  private async applySink(): Promise<void> {
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(this.opts.sinkId || '');
    } catch (e) {
      playerStatus.set({ error: `sink: ${String(e)}` });
    }
  }

  private ensure(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const ctx = new AudioContext({
        latencyHint: this.opts.latency,
        ...(this.opts.sampleRate ? { sampleRate: this.opts.sampleRate } : {}),
      });
      await ctx.audioWorklet.addModule('worklet.js');
      const node = new AudioWorkletNode(ctx, 'mindhz-engine', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.port.onmessage = (e: MessageEvent<WorkletStatus | { type: 'sleepFired' }>) => this.onMessage(e.data);
      const splitter = ctx.createChannelSplitter(2);
      const aL = ctx.createAnalyser();
      const aR = ctx.createAnalyser();
      const aM = ctx.createAnalyser();
      aL.fftSize = aR.fftSize = 2048;
      aM.fftSize = 16384;
      aM.smoothingTimeConstant = 0.75;
      node.connect(ctx.destination);
      node.connect(splitter);
      splitter.connect(aL, 0);
      splitter.connect(aR, 1);
      node.connect(aM);
      this.ctx = ctx;
      this.node = node;
      this.analyserL = aL;
      this.analyserR = aR;
      this.analyserMix = aM;
      if (this.opts.sinkId) await this.applySink();
      playerStatus.set({
        sampleRate: ctx.sampleRate,
        outputLatency: (ctx.outputLatency || 0) + ctx.baseLatency,
        error: null,
      });
    })().catch((e) => {
      this.initPromise = null;
      playerStatus.set({ error: String(e) });
      throw e;
    });
    return this.initPromise;
  }

  private onMessage(m: WorkletStatus | { type: 'sleepFired' }): void {
    if (m.type === 'sleepFired') {
      this.onSleepFired?.();
      return;
    }
    const prev = playerStatus.get().state;
    for (let i = 0; i < m.env.length; i++) {
      this.envelope[this.envelopeHead] = m.env[i];
      this.envelopeHead = (this.envelopeHead + 1) % this.envelope.length;
    }
    playerStatus.set({
      state: m.state as PlayState,
      position: m.position,
      duration: m.duration,
      stageIndex: m.stageIndex,
      loop: m.loop,
      peakL: m.peakL,
      peakR: m.peakR,
      sleepLeft: m.sleepLeft,
    });
    if (m.state !== prev) {
      if (m.state === 'ended') this.onEnded?.();
      if (m.state === 'stopped' || m.state === 'ended' || m.state === 'paused') this.scheduleSuspend();
    }
  }

  private send(c: WorkletCommand): void {
    this.node?.port.postMessage(c);
  }

  /** Suspend the audio device after a period of silence (saves CPU/battery). */
  private scheduleSuspend(): void {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = window.setTimeout(() => {
      const s = playerStatus.get().state;
      if (this.ctx && (s === 'stopped' || s === 'ended' || s === 'paused')) void this.ctx.suspend();
    }, 1500);
  }

  private async wake(): Promise<void> {
    await this.ensure();
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
  }

  async load(session: Session, autoplay: boolean): Promise<void> {
    await this.wake();
    this.send({ type: 'load', session, autoplay });
    this.envelope.fill(0);
  }

  update(session: Session): void {
    this.send({ type: 'update', session });
  }

  async play(): Promise<void> {
    await this.wake();
    this.send({ type: 'play' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  stop(fade = 0.3): void {
    this.send({ type: 'stop', fade });
  }

  setMaster(volume: number, immediate = false): void {
    this.send({ type: 'master', volume, immediate });
  }

  setSleep(seconds: number | null): void {
    this.send({ type: 'sleep', seconds });
  }

  get ready(): boolean {
    return !!this.node;
  }

  async dispose(): Promise<void> {
    const ctx = this.ctx;
    this.node?.disconnect();
    this.node = null;
    this.ctx = null;
    this.analyserL = this.analyserR = this.analyserMix = null;
    this.initPromise = null;
    playerStatus.set({ state: 'stopped', position: 0 });
    if (ctx) await ctx.close().catch(() => undefined);
  }

  async listOutputs(): Promise<{ id: string; label: string }[]> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs
        .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }));
    } catch {
      return [];
    }
  }
}

export const audio = new AudioService();
