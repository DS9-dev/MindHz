/**
 * Defensive sanitisers for everything read from disk or imported by the user.
 * Invalid fields are replaced by safe defaults; structurally broken items are
 * dropped. Nothing from a file is trusted as-is.
 */
import { LIMITS, clamp, uid } from './model';
import type {
  CustomFrequency,
  ExportSettings,
  Layer,
  LayerKind,
  Library,
  NoiseColor,
  PresetDirection,
  Session,
  SessionMeta,
  Settings,
  Stage,
} from './types';

export const SETTINGS_VERSION = 1;
export const LIBRARY_VERSION = 1;

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'flac',
  sampleRate: 48000,
  bitDepth: 24,
  channels: 2,
  fadeInSec: 5,
  fadeOutSec: 10,
  durationMin: 30,
};

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  theme: 'system',
  language: 'ru',
  mica: true,
  reduceMotion: false,
  outputDeviceId: '',
  sampleRate: 0,
  latency: 'playback',
  volumeLimit: 0.8,
  masterVolume: 0.3,
  safetyAccepted: false,
  headphoneHintSeen: false,
  export: DEFAULT_EXPORT,
  lastView: 'generator',
};

export const DEFAULT_LIBRARY: Library = {
  version: LIBRARY_VERSION,
  sessions: [],
  favorites: [],
  customFrequencies: [],
  generator: null,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d;
const str = (v: unknown, d: string, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string | number>(v: unknown, opts: readonly T[], d: T): T =>
  opts.includes(v as T) ? (v as T) : d;

const KINDS: LayerKind[] = ['tone', 'binaural', 'monaural', 'isochronic', 'am', 'noise'];
const COLORS: NoiseColor[] = ['white', 'pink', 'brown'];
const DIRECTIONS: PresetDirection[] = ['mind', 'emotion', 'rest', 'esoteric', 'custom'];
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const id = (v: unknown, prefix: string): string => (typeof v === 'string' && SAFE_ID.test(v) ? v : uid(prefix));

export function sanitizeLayer(v: unknown): Layer | null {
  if (!isObj(v)) return null;
  const kind = oneOf(v.kind, KINDS, 'tone');
  if (!KINDS.includes(v.kind as LayerKind)) return null;
  return {
    id: id(v.id, 'layer'),
    kind,
    enabled: bool(v.enabled, true),
    volume: num(v.volume, 0.5, 0, 1),
    pan: num(v.pan, 0, -1, 1),
    carrierHz: num(v.carrierHz, 200, LIMITS.carrierMin, LIMITS.carrierMax),
    beatHz: num(v.beatHz, 10, 0, LIMITS.beatMax),
    depth: num(v.depth, 0.8, 0, 1),
    duty: num(v.duty, 0.5, 0.1, 0.9),
    noiseColor: oneOf(v.noiseColor, COLORS, 'pink'),
    ...(typeof v.label === 'string' ? { label: str(v.label, '', 60) } : {}),
  };
}

export function sanitizeStage(v: unknown): Stage | null {
  if (!isObj(v)) return null;
  const layers = Array.isArray(v.layers)
    ? v.layers.map(sanitizeLayer).filter((x): x is Layer => !!x).slice(0, LIMITS.maxLayers)
    : [];
  return {
    id: id(v.id, 'stage'),
    name: str(v.name, 'Этап', 80),
    durationSec: num(v.durationSec, 600, LIMITS.stageMinSec, LIMITS.stageMaxSec),
    transitionSec: num(v.transitionSec, 20, 0, LIMITS.transitionMaxSec),
    transition: oneOf(v.transition, ['smooth', 'instant'] as const, 'smooth'),
    volume: num(v.volume, 1, 0, 1),
    layers,
  };
}

function sanitizeMeta(v: unknown): SessionMeta | undefined {
  if (!isObj(v)) return undefined;
  return {
    direction: oneOf(v.direction, DIRECTIONS, 'custom'),
    ...(typeof v.purpose === 'string' ? { purpose: str(v.purpose, '', 600) } : {}),
    ...(typeof v.explanation === 'string' ? { explanation: str(v.explanation, '', 2000) } : {}),
    ...(v.evidence
      ? {
          evidence: oneOf(
            v.evidence,
            ['established', 'supported', 'preliminary', 'insufficient', 'esoteric'] as const,
            'insufficient',
          ),
        }
      : {}),
    ...(Array.isArray(v.refs) ? { refs: v.refs.filter((r): r is string => typeof r === 'string').slice(0, 20) } : {}),
    ...(typeof v.needsHeadphones === 'boolean' ? { needsHeadphones: v.needsHeadphones } : {}),
  };
}

export function sanitizeSession(v: unknown): Session | null {
  if (!isObj(v)) return null;
  const stages = Array.isArray(v.stages)
    ? v.stages.map(sanitizeStage).filter((x): x is Stage => !!x).slice(0, LIMITS.maxStages)
    : [];
  if (stages.length === 0) return null;
  const meta = sanitizeMeta(v.meta);
  return {
    id: id(v.id, 'session'),
    name: str(v.name, 'Сеанс', 120),
    stages,
    fadeInSec: num(v.fadeInSec, 5, 0, LIMITS.fadeMaxSec),
    fadeOutSec: num(v.fadeOutSec, 8, 0, LIMITS.fadeMaxSec),
    loop: bool(v.loop, false),
    ...(meta ? { meta } : {}),
    ...(typeof v.createdAt === 'number' ? { createdAt: v.createdAt } : {}),
    ...(typeof v.updatedAt === 'number' ? { updatedAt: v.updatedAt } : {}),
  };
}

function sanitizeExport(v: unknown): ExportSettings {
  const o = isObj(v) ? v : {};
  return {
    format: oneOf(o.format, ['wav', 'flac'] as const, DEFAULT_EXPORT.format),
    sampleRate: oneOf(o.sampleRate, [44100, 48000, 96000] as const, 48000),
    bitDepth: oneOf(o.bitDepth, [16, 24, 32] as const, 24),
    channels: oneOf(o.channels, [1, 2] as const, 2),
    fadeInSec: num(o.fadeInSec, DEFAULT_EXPORT.fadeInSec, 0, LIMITS.fadeMaxSec),
    fadeOutSec: num(o.fadeOutSec, DEFAULT_EXPORT.fadeOutSec, 0, LIMITS.fadeMaxSec),
    durationMin: num(o.durationMin, DEFAULT_EXPORT.durationMin, 0.1, 360),
  };
}

export function sanitizeSettings(v: unknown): Settings {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_SETTINGS;
  const volumeLimit = num(o.volumeLimit, d.volumeLimit, 0.1, 1);
  return {
    version: SETTINGS_VERSION,
    theme: oneOf(o.theme, ['system', 'dark', 'light'] as const, d.theme),
    language: oneOf(o.language, ['ru', 'en'] as const, d.language),
    mica: bool(o.mica, d.mica),
    reduceMotion: bool(o.reduceMotion, d.reduceMotion),
    outputDeviceId: str(o.outputDeviceId, '', 300),
    sampleRate: oneOf(o.sampleRate, [0, 44100, 48000, 96000] as const, 0),
    latency: oneOf(o.latency, ['interactive', 'balanced', 'playback'] as const, d.latency),
    volumeLimit,
    masterVolume: Math.min(num(o.masterVolume, d.masterVolume, 0, 1), volumeLimit),
    safetyAccepted: bool(o.safetyAccepted, false),
    headphoneHintSeen: bool(o.headphoneHintSeen, false),
    export: sanitizeExport(o.export),
    lastView: oneOf(o.lastView, ['generator', 'catalog', 'presets', 'builder', 'settings'] as const, 'generator'),
  };
}

function sanitizeCustom(v: unknown): CustomFrequency | null {
  if (!isObj(v) || typeof v.hz !== 'number' || !Number.isFinite(v.hz)) return null;
  return {
    id: id(v.id, 'custom'),
    name: str(v.name, 'Моя частота', 80),
    hz: clamp(v.hz, 0.1, LIMITS.carrierMax),
    quantity: oneOf(v.quantity, ['audible', 'rhythm'] as const, 'audible'),
    note: str(v.note, '', 1000),
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
  };
}

export function sanitizeLibrary(v: unknown): Library {
  const o = isObj(v) ? v : {};
  const sessions = Array.isArray(o.sessions)
    ? o.sessions.map(sanitizeSession).filter((x): x is Session => !!x).slice(0, 500)
    : [];
  return {
    version: LIBRARY_VERSION,
    sessions,
    favorites: Array.isArray(o.favorites)
      ? Array.from(new Set(o.favorites.filter((f): f is string => typeof f === 'string' && SAFE_ID.test(f)))).slice(0, 500)
      : [],
    customFrequencies: Array.isArray(o.customFrequencies)
      ? o.customFrequencies.map(sanitizeCustom).filter((x): x is CustomFrequency => !!x).slice(0, 500)
      : [],
    generator: sanitizeSession(o.generator),
  };
}

/** Export format for user presets (JSON file). */
export interface PresetBundle {
  app: 'MindHz';
  kind: 'presets';
  version: 1;
  exportedAt: string;
  sessions: Session[];
  customFrequencies?: CustomFrequency[];
}

export function makeBundle(sessions: Session[], customFrequencies: CustomFrequency[] = []): PresetBundle {
  return { app: 'MindHz', kind: 'presets', version: 1, exportedAt: new Date().toISOString(), sessions, customFrequencies };
}

/** Parse an imported bundle (or a single session). Imported items get fresh ids. */
export function parseBundle(text: string): { sessions: Session[]; customFrequencies: CustomFrequency[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('IMPORT_INVALID_JSON');
  }
  const rawSessions: unknown[] = isObj(data) && Array.isArray(data.sessions) ? data.sessions : [data];
  const sessions = rawSessions
    .map(sanitizeSession)
    .filter((x): x is Session => !!x)
    .map((s) => ({ ...s, id: uid('session'), builtin: false }));
  const customFrequencies =
    isObj(data) && Array.isArray(data.customFrequencies)
      ? data.customFrequencies.map(sanitizeCustom).filter((x): x is CustomFrequency => !!x).map((c) => ({ ...c, id: uid('custom') }))
      : [];
  if (!sessions.length && !customFrequencies.length) throw new Error('IMPORT_EMPTY');
  return { sessions, customFrequencies };
}
