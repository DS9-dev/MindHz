/**
 * Core data model shared by the main process, the renderer, the AudioWorklet
 * and the export worker. Everything here must stay free of DOM / Node APIs.
 */

/** Generation methods supported by the audio engine. */
export type LayerKind = 'tone' | 'binaural' | 'monaural' | 'isochronic' | 'am' | 'noise';

export type NoiseColor = 'white' | 'pink' | 'brown';

export type TransitionKind = 'smooth' | 'instant';

/**
 * One sound source. Not every field is used by every kind:
 *  - carrierHz: audible frequency of the tone (all kinds except noise)
 *  - beatHz:    beat / modulation / pulse rate (binaural, monaural, isochronic, am)
 *  - depth:     modulation depth 0..1 (isochronic, am)
 *  - duty:      pulse duty cycle 0.1..0.9 (isochronic)
 *  - pan:       stereo balance -1..1 (not used by binaural, which needs both ears)
 *  - noiseColor (noise)
 */
export interface Layer {
  id: string;
  kind: LayerKind;
  enabled: boolean;
  /** 0..1, linear. The engine normalises the sum of all layers so the mix never clips. */
  volume: number;
  pan: number;
  carrierHz: number;
  beatHz: number;
  depth: number;
  duty: number;
  noiseColor: NoiseColor;
  label?: string;
}

export interface Stage {
  id: string;
  name: string;
  /** Total stage length in seconds, including the transition into it. */
  durationSec: number;
  /** Length of the morph from the previous stage (ignored for the first stage). */
  transitionSec: number;
  transition: TransitionKind;
  /** Stage intensity 0..1 (multiplies every layer of the stage). */
  volume: number;
  layers: Layer[];
}

export type PresetDirection = 'mind' | 'emotion' | 'rest' | 'esoteric' | 'custom';

export type EvidenceLevel =
  | 'established' // well-established physical or physiological fact
  | 'supported' // effect supported by research
  | 'preliminary' // preliminary or contradictory hypothesis
  | 'insufficient' // insufficiently researched
  | 'esoteric'; // esoteric or cultural belief without scientific support

export interface SessionMeta {
  direction: PresetDirection;
  /** Intended use, phrased as intention, never as a promise. */
  purpose?: string;
  explanation?: string;
  evidence?: EvidenceLevel;
  refs?: string[];
  needsHeadphones?: boolean;
}

export interface Session {
  id: string;
  name: string;
  stages: Stage[];
  fadeInSec: number;
  fadeOutSec: number;
  /** Continuous listening: after the last stage the last stage is held until stopped. */
  loop: boolean;
  builtin?: boolean;
  meta?: SessionMeta;
  createdAt?: number;
  updatedAt?: number;
}

export type ThemeSetting = 'system' | 'dark' | 'light';
export type Language = 'ru' | 'en';
export type ExportFormat = 'wav' | 'flac';
export type BitDepth = 16 | 24 | 32;

export interface ExportSettings {
  format: ExportFormat;
  sampleRate: number;
  bitDepth: BitDepth;
  channels: 1 | 2;
  fadeInSec: number;
  fadeOutSec: number;
  durationMin: number;
}

export interface Settings {
  version: number;
  theme: ThemeSetting;
  language: Language;
  mica: boolean;
  reduceMotion: boolean;
  outputDeviceId: string;
  /** 0 = system default */
  sampleRate: number;
  latency: 'interactive' | 'balanced' | 'playback';
  /** Upper bound for the master volume slider (0.1..1). */
  volumeLimit: number;
  masterVolume: number;
  safetyAccepted: boolean;
  headphoneHintSeen: boolean;
  export: ExportSettings;
  lastView: string;
}

export interface CustomFrequency {
  id: string;
  name: string;
  hz: number;
  quantity: 'audible' | 'rhythm';
  note: string;
  createdAt: number;
}

export interface Library {
  version: number;
  /** User sessions / presets (multi-stage). */
  sessions: Session[];
  favorites: string[];
  customFrequencies: CustomFrequency[];
  /** The working state of the generator, restored on next start. */
  generator: Session | null;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
  portable: boolean;
  dataPath: string;
  isPackaged: boolean;
  micaSupported: boolean;
  smokeTest: boolean;
}
