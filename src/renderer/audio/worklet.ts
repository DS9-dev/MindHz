/**
 * AudioWorklet host for the shared SynthEngine. Runs on the real-time audio thread;
 * the render path allocates nothing except the periodic status message.
 */
import { SynthEngine } from '../../shared/audio/engine';
import type { Session } from '../../shared/types';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: unknown): void;

export type WorkletCommand =
  | { type: 'load'; session: Session; autoplay: boolean }
  | { type: 'update'; session: Session }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop'; fade?: number }
  | { type: 'master'; volume: number; immediate?: boolean }
  | { type: 'sleep'; seconds: number | null };

export interface WorkletStatus {
  type: 'status';
  state: string;
  position: number;
  duration: number;
  stageIndex: number;
  loop: boolean;
  peakL: number;
  peakR: number;
  /** Envelope samples (max |x| of both channels) at ENV_RATE per second. */
  env: Float32Array;
  sleepLeft: number | null;
}

const ENV_RATE = 200;
const STATUS_HZ = 20;

class MindHzProcessor extends AudioWorkletProcessor {
  private engine = new SynthEngine(sampleRate);
  private sleepLeft = -1; // samples
  private envStep = Math.max(1, Math.round(sampleRate / ENV_RATE));
  private envCount = 0;
  private envPeak = 0;
  private envBuf = new Float32Array(64);
  private envLen = 0;
  private statusEvery = Math.round(sampleRate / STATUS_HZ);
  private sinceStatus = 0;
  private lastState = '';
  private pendingLoad: { session: Session; autoplay: boolean } | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletCommand>) => this.command(e.data);
  }

  private command(c: WorkletCommand): void {
    switch (c.type) {
      case 'load':
        // never cut a sounding session: fade it out first, then swap (see process())
        this.pendingLoad = { session: c.session, autoplay: c.autoplay };
        if (this.engine.isSounding) this.engine.stop(0.08);
        else this.applyPending();
        break;
      case 'update':
        this.engine.setSession(c.session, true);
        break;
      case 'play':
        this.engine.play();
        break;
      case 'pause':
        this.engine.pause();
        break;
      case 'stop':
        this.engine.stop(c.fade ?? 0.3);
        this.sleepLeft = -1;
        break;
      case 'master':
        this.engine.setMasterVolume(c.volume, !!c.immediate);
        break;
      case 'sleep':
        this.sleepLeft = c.seconds && c.seconds > 0 ? Math.round(c.seconds * sampleRate) : -1;
        break;
    }
    this.sinceStatus = this.statusEvery; // report promptly after a command
  }

  private applyPending(): void {
    const p = this.pendingLoad;
    if (!p) return;
    this.pendingLoad = null;
    this.engine.stop(0);
    this.engine.setSession(p.session, false);
    if (p.autoplay) this.engine.play();
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    const n = L.length;
    this.engine.process(L, R, n);
    if (this.pendingLoad && !this.engine.isSounding) this.applyPending();

    const st = this.engine.status();
    if (this.sleepLeft > 0 && st.state === 'playing') {
      this.sleepLeft -= n;
      if (this.sleepLeft <= 0) {
        this.engine.stop(12); // gentle 12 s fade for the sleep timer
        this.sleepLeft = -1;
        this.port.postMessage({ type: 'sleepFired' });
      }
    }

    if (this.engine.isSounding) {
      for (let i = 0; i < n; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (a > this.envPeak) this.envPeak = a;
        if (++this.envCount >= this.envStep) {
          if (this.envLen < this.envBuf.length) this.envBuf[this.envLen++] = this.envPeak;
          this.envPeak = 0;
          this.envCount = 0;
        }
      }
    }

    this.sinceStatus += n;
    if (this.sinceStatus >= this.statusEvery || st.state !== this.lastState) {
      this.sinceStatus = 0;
      this.lastState = st.state;
      const [peakL, peakR] = this.engine.takePeaks();
      const msg: WorkletStatus = {
        type: 'status',
        state: st.state,
        position: st.positionSec,
        duration: st.durationSec,
        stageIndex: st.stageIndex,
        loop: st.loop,
        peakL,
        peakR,
        env: this.envBuf.slice(0, this.envLen),
        sleepLeft: this.sleepLeft > 0 ? this.sleepLeft / sampleRate : null,
      };
      this.envLen = 0;
      this.port.postMessage(msg);
    }
    return true;
  }
}

registerProcessor('mindhz-engine', MindHzProcessor);
