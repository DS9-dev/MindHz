/**
 * Technical sanity checks for layers. Messages are i18n keys; `fix` is a
 * suggested valid alternative the UI can apply with one click.
 */
import type { Layer } from '../types';

export type BandId = 'infra' | 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma' | 'high';

/** Conventional EEG bands (boundaries differ slightly between labs). */
export const BANDS: { id: Exclude<BandId, 'infra' | 'high'>; lo: number; hi: number }[] = [
  { id: 'delta', lo: 0.5, hi: 4 },
  { id: 'theta', lo: 4, hi: 8 },
  { id: 'alpha', lo: 8, hi: 13 },
  { id: 'beta', lo: 13, hi: 30 },
  { id: 'gamma', lo: 30, hi: 100 },
];

export function bandOf(hz: number): BandId {
  if (hz < 0.5) return 'infra';
  for (const b of BANDS) if (hz < b.hi) return b.id;
  return hz <= 100 ? 'gamma' : 'high';
}

export type IssueLevel = 'info' | 'warn' | 'error';

export interface LayerIssue {
  level: IssueLevel;
  code: string;
  /** i18n key */
  msg: string;
  params?: Record<string, string | number>;
  fix?: Partial<Layer>;
  /** i18n key of the fix button */
  fixLabel?: string;
}

const USES_BEAT = new Set(['binaural', 'monaural', 'isochronic', 'am']);

export function validateLayer(l: Layer): LayerIssue[] {
  const out: LayerIssue[] = [];
  if (l.kind === 'noise') return out;
  const c = l.carrierHz;
  const b = l.beatHz;

  if (c < 20) {
    if (l.kind === 'tone') {
      out.push({
        level: 'warn',
        code: 'infrasonic-tone',
        msg: 'issue.infrasonicTone',
        params: { hz: c },
        fix: { kind: 'isochronic', carrierHz: 220, beatHz: Math.max(0.5, c), depth: 1, duty: 0.5 },
        fixLabel: 'issue.fix.useRhythm',
      });
    } else {
      out.push({
        level: 'warn',
        code: 'inaudible-carrier',
        msg: 'issue.inaudibleCarrier',
        params: { hz: c },
        fix: { carrierHz: 200 },
        fixLabel: 'issue.fix.carrier200',
      });
    }
  } else if (c > 16000) {
    out.push({ level: 'info', code: 'very-high', msg: 'issue.veryHigh', params: { hz: c } });
  }

  if (USES_BEAT.has(l.kind)) {
    if (b > c / 2 && c >= 20) {
      out.push({
        level: 'error',
        code: 'beat-vs-carrier',
        msg: 'issue.beatVsCarrier',
        fix: { carrierHz: Math.max(200, Math.ceil(b * 4)) },
        fixLabel: 'issue.fix.raiseCarrier',
      });
    }
    if (b < 0.5) out.push({ level: 'info', code: 'very-slow', msg: 'issue.verySlow' });
  }

  if (l.kind === 'binaural') {
    out.push({ level: 'info', code: 'headphones', msg: 'issue.headphones' });
    if (c > 1500) {
      out.push({
        level: 'warn',
        code: 'binaural-high-carrier',
        msg: 'issue.binauralHighCarrier',
        fix: { carrierHz: 250 },
        fixLabel: 'issue.fix.carrier250',
      });
    }
    if (b > 40) {
      out.push({
        level: 'warn',
        code: 'binaural-fast-beat',
        msg: 'issue.binauralFastBeat',
        fix: { kind: 'isochronic', depth: 1, duty: 0.5 },
        fixLabel: 'issue.fix.useIsochronic',
      });
    }
  }

  if ((l.kind === 'isochronic' || l.kind === 'am') && l.depth < 0.3) {
    out.push({ level: 'info', code: 'shallow', msg: 'issue.shallowDepth' });
  }
  if (l.kind === 'isochronic' && b > 15 && b < 30) {
    out.push({ level: 'info', code: 'rhythm-comfort', msg: 'issue.rhythmComfort' });
  }
  return out;
}

/** Which of the three distinct quantities a layer represents. */
export function describeLayer(l: Layer): {
  audibleHz: number[];
  rhythmHz: number | null;
  band: BandId | null;
} {
  switch (l.kind) {
    case 'noise':
      return { audibleHz: [], rhythmHz: null, band: null };
    case 'tone':
      return { audibleHz: [l.carrierHz], rhythmHz: null, band: null };
    case 'binaural':
    case 'monaural':
      return {
        audibleHz: [Math.max(0, l.carrierHz - l.beatHz / 2), l.carrierHz + l.beatHz / 2],
        rhythmHz: l.beatHz,
        band: bandOf(l.beatHz),
      };
    default:
      return { audibleHz: [l.carrierHz], rhythmHz: l.beatHz, band: bandOf(l.beatHz) };
  }
}
