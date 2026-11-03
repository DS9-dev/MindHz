/**
 * Application state and actions. Persistence is debounced and goes through the
 * main process (atomic writes); audio side effects go through AudioService.
 */
import { needsHeadphones } from '../../shared/model';
import { makeLayer, makeSession, makeStage, cloneSession, uid } from '../../shared/model';
import { DEFAULT_LIBRARY, DEFAULT_SETTINGS, makeBundle, parseBundle } from '../../shared/schema';
import type { AppInfo, CustomFrequency, Layer, Library, Session, Settings } from '../../shared/types';
import { api } from '../api';
import { audio, playerStatus } from '../audio/AudioService';
import { setLanguage, t } from '../i18n';
import { createStore } from './store';

export type View = 'generator' | 'catalog' | 'presets' | 'builder' | 'settings';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

export type Modal =
  | { kind: 'export'; session: Session; title: string }
  | { kind: 'safety' }
  | { kind: 'preset'; session: Session }
  | { kind: 'save-preset'; session: Session }
  | { kind: 'confirm'; title: string; text: string; confirm: string; danger?: boolean; run: () => void }
  | { kind: 'custom-frequency' };

export interface NowPlaying {
  kind: 'generator' | 'session';
  id: string;
  name: string;
}

export interface AppState {
  ready: boolean;
  info: AppInfo | null;
  settings: Settings;
  library: Library;
  view: View;
  generator: Session;
  builderId: string | null;
  nowPlaying: NowPlaying | null;
  playing: Session | null;
  toasts: Toast[];
  modal: Modal | null;
  dark: boolean;
  catalogSelection: string | null;
}

export function defaultGenerator(): Session {
  return makeSession({
    id: 'generator',
    name: 'Генератор',
    loop: true,
    fadeInSec: 3,
    fadeOutSec: 6,
    stages: [
      makeStage({
        id: 'generator-stage',
        name: 'Генератор',
        durationSec: 30 * 60,
        layers: [
          makeLayer('binaural', { id: 'g-binaural', carrierHz: 200, beatHz: 10, volume: 0.55 }),
          makeLayer('noise', { id: 'g-noise', noiseColor: 'pink', volume: 0.25 }),
        ],
      }),
    ],
  });
}

export const app = createStore<AppState>({
  ready: false,
  info: null,
  settings: DEFAULT_SETTINGS,
  library: DEFAULT_LIBRARY,
  view: 'generator',
  generator: defaultGenerator(),
  builderId: null,
  nowPlaying: null,
  playing: null,
  toasts: [],
  modal: null,
  dark: true,
  catalogSelection: null,
});

// ── persistence ─────────────────────────────────────────────────────────────
let settingsTimer: number | null = null;
let libraryTimer: number | null = null;

function persistSettings(): void {
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => {
    settingsTimer = null;
    api.saveSettings(app.get().settings).catch((e) => toast('error', `${t('toast.saveFailed')}: ${e}`));
  }, 300);
}

function persistLibrary(): void {
  if (libraryTimer) clearTimeout(libraryTimer);
  libraryTimer = window.setTimeout(() => {
    libraryTimer = null;
    const s = app.get();
    api
      .saveLibrary({ ...s.library, generator: s.generator })
      .catch((e) => toast('error', `${t('toast.saveFailed')}: ${e}`));
  }, 400);
}

/** Flush pending saves immediately (used by the smoke test and before unload). */
export async function flushPersistence(): Promise<void> {
  const s = app.get();
  if (settingsTimer) clearTimeout(settingsTimer);
  if (libraryTimer) clearTimeout(libraryTimer);
  settingsTimer = libraryTimer = null;
  await api.saveSettings(s.settings);
  await api.saveLibrary({ ...s.library, generator: s.generator });
}

// ── toasts / modals ─────────────────────────────────────────────────────────
let toastId = 0;
export function toast(kind: Toast['kind'], text: string, action?: Toast['action']): void {
  const id = ++toastId;
  app.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text, action }] }));
  window.setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 4500);
}
export function dismissToast(id: number): void {
  app.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
}
export const openModal = (modal: Modal) => app.set({ modal });
export const closeModal = () => app.set({ modal: null });

// ── theme ──────────────────────────────────────────────────────────────────
const media = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme(): void {
  const s = app.get().settings;
  const dark = s.theme === 'dark' || (s.theme === 'system' && media.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.mica = String(!!app.get().info?.micaSupported && s.mica);
  root.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
  root.lang = s.language;
  if (app.get().dark !== dark) app.set({ dark });
}
media.addEventListener('change', applyTheme);

// ── settings ───────────────────────────────────────────────────────────────
export function updateSettings(patch: Partial<Settings>): void {
  const prev = app.get().settings;
  let next = { ...prev, ...patch };
  if (next.masterVolume > next.volumeLimit) next = { ...next, masterVolume: next.volumeLimit };
  app.set({ settings: next });
  if (patch.language) setLanguage(patch.language);
  if ('theme' in patch || 'mica' in patch || 'reduceMotion' in patch || 'language' in patch) applyTheme();
  if (next.masterVolume !== prev.masterVolume) audio.setMaster(next.masterVolume);
  if (next.sampleRate !== prev.sampleRate || next.latency !== prev.latency || next.outputDeviceId !== prev.outputDeviceId) {
    const wasPlaying = playerStatus.get().state === 'playing';
    audio.configure({ sampleRate: next.sampleRate, latency: next.latency, sinkId: next.outputDeviceId });
    if (wasPlaying && (next.sampleRate !== prev.sampleRate || next.latency !== prev.latency)) {
      app.set({ nowPlaying: null, playing: null });
      toast('info', t('toast.audioRestarted'));
    }
  }
  persistSettings();
}

export function setMasterVolume(v: number): void {
  const lim = app.get().settings.volumeLimit;
  updateSettings({ masterVolume: Math.max(0, Math.min(lim, v)) });
}

// ── library ────────────────────────────────────────────────────────────────
export function updateLibrary(fn: (l: Library) => Partial<Library>): void {
  app.set((s) => ({ library: { ...s.library, ...fn(s.library) } }));
  persistLibrary();
}

export function toggleFavorite(id: string): void {
  updateLibrary((l) => ({
    favorites: l.favorites.includes(id) ? l.favorites.filter((f) => f !== id) : [...l.favorites, id],
  }));
}

export function saveUserSession(session: Session): Session {
  const now = Date.now();
  const s: Session = { ...session, builtin: false, updatedAt: now, createdAt: session.createdAt ?? now };
  updateLibrary((l) => {
    const i = l.sessions.findIndex((x) => x.id === s.id);
    const sessions = [...l.sessions];
    if (i >= 0) sessions[i] = s;
    else sessions.unshift(s);
    return { sessions };
  });
  // live-update if this session is currently playing
  const np = app.get().nowPlaying;
  if (np?.kind === 'session' && np.id === s.id) {
    app.set({ playing: s, nowPlaying: { ...np, name: s.name } });
    audio.update(s);
  }
  return s;
}

export function deleteUserSession(id: string): void {
  updateLibrary((l) => ({ sessions: l.sessions.filter((s) => s.id !== id) }));
  if (app.get().builderId === id) app.set({ builderId: null });
}

export function duplicateToLibrary(session: Session, open = true): Session {
  const copy = cloneSession(session, {
    name: session.builtin ? session.name : `${session.name} (${t('common.copy')})`,
    meta: { ...(session.meta ?? { direction: 'custom' }), direction: session.meta?.direction ?? 'custom' },
  });
  saveUserSession(copy);
  if (open) app.set({ builderId: copy.id, view: 'builder' });
  return copy;
}

export function addCustomFrequency(c: Omit<CustomFrequency, 'id' | 'createdAt'>): void {
  updateLibrary((l) => ({
    customFrequencies: [{ ...c, id: uid('custom'), createdAt: Date.now() }, ...l.customFrequencies],
  }));
}

export function removeCustomFrequency(id: string): void {
  updateLibrary((l) => ({
    customFrequencies: l.customFrequencies.filter((c) => c.id !== id),
    favorites: l.favorites.filter((f) => f !== id),
  }));
}

export async function exportPresetsFile(sessions: Session[], name = 'MindHz-presets'): Promise<void> {
  const { customFrequencies } = app.get().library;
  const ok = await api.presets.save(JSON.stringify(makeBundle(sessions, customFrequencies), null, 2), name);
  if (ok) toast('success', t('toast.presetsExported'));
}

export async function importPresetsFile(): Promise<void> {
  try {
    const text = await api.presets.open();
    if (!text) return;
    const { sessions, customFrequencies } = parseBundle(text);
    updateLibrary((l) => ({
      sessions: [...sessions, ...l.sessions],
      customFrequencies: [...customFrequencies, ...l.customFrequencies],
    }));
    toast('success', t('toast.imported', { n: sessions.length + customFrequencies.length }));
  } catch (e) {
    const code = e instanceof Error ? e.message : String(e);
    toast('error', code.includes('IMPORT_') ? t(code.includes('EMPTY') ? 'toast.importEmpty' : 'toast.importInvalid') : String(e));
  }
}

// ── generator ──────────────────────────────────────────────────────────────
let genFrame = 0;
export function setGenerator(session: Session): void {
  app.set({ generator: session });
  const np = app.get().nowPlaying;
  if (np?.kind === 'generator') {
    if (!genFrame)
      genFrame = requestAnimationFrame(() => {
        genFrame = 0;
        const g = app.get().generator;
        app.set({ playing: g });
        audio.update(g);
      });
  }
  persistLibrary();
}

export function updateGeneratorLayers(fn: (layers: Layer[]) => Layer[]): void {
  const g = app.get().generator;
  const stage = g.stages[0];
  setGenerator({ ...g, stages: [{ ...stage, layers: fn(stage.layers) }] });
}

// ── transport ──────────────────────────────────────────────────────────────
function headphoneHint(session: Session): void {
  const s = app.get().settings;
  if (!s.headphoneHintSeen && session.stages.some((st) => needsHeadphones(st.layers))) {
    toast('info', t('toast.headphones'));
    updateSettings({ headphoneHintSeen: true });
  }
}

export async function playSession(session: Session, kind: NowPlaying['kind'] = 'session'): Promise<void> {
  if (!app.get().settings.safetyAccepted) {
    openModal({ kind: 'safety' });
    return;
  }
  try {
    audio.setMaster(app.get().settings.masterVolume, !audio.ready);
    await audio.load(session, true);
    audio.setMaster(app.get().settings.masterVolume, true);
    app.set({ nowPlaying: { kind, id: session.id, name: session.name }, playing: session });
    headphoneHint(session);
    void api.setPlaying(true);
  } catch (e) {
    toast('error', `${t('toast.audioError')}: ${e}`);
  }
}

export function playGenerator(): Promise<void> {
  return playSession(app.get().generator, 'generator');
}

export async function togglePlay(): Promise<void> {
  const st = playerStatus.get().state;
  if (st === 'playing') {
    audio.pause();
    return;
  }
  if (st === 'paused' || st === 'pausing') {
    await audio.play();
    return;
  }
  const s = app.get();
  if (s.playing && s.nowPlaying) {
    const fresh = s.nowPlaying.kind === 'generator' ? s.generator : s.playing;
    return playSession(fresh, s.nowPlaying.kind);
  }
  return playGenerator();
}

export function stopPlayback(): void {
  audio.stop(0.4);
  void api.setPlaying(false);
}

export function setContinuous(loop: boolean): void {
  const s = app.get();
  if (!s.playing || !s.nowPlaying) return;
  if (s.nowPlaying.kind === 'generator') {
    setGenerator({ ...s.generator, loop });
    return;
  }
  const next = { ...s.playing, loop };
  app.set({ playing: next });
  audio.update(next);
}

audio.setCallbacks({
  onSleepFired: () => {
    toast('info', t('toast.sleepFired'));
    void api.setPlaying(false);
  },
  onEnded: () => void api.setPlaying(false),
});

// ── boot ───────────────────────────────────────────────────────────────────
export async function boot(): Promise<void> {
  const [info, data] = await Promise.all([api.info(), api.load()]);
  setLanguage(data.settings.language);
  app.set({
    info,
    settings: data.settings,
    library: data.library,
    generator: data.library.generator ?? defaultGenerator(),
    view: data.settings.lastView as View,
    ready: true,
  });
  applyTheme();
  audio.configure({
    sampleRate: data.settings.sampleRate,
    latency: data.settings.latency,
    sinkId: data.settings.outputDeviceId,
  });
  if (data.recovered) toast('warn', t('toast.recovered'));
  if (data.portableFallback) toast('warn', t('toast.portableFallback'));
  if (!data.settings.safetyAccepted && !info.smokeTest) openModal({ kind: 'safety' });
  window.addEventListener('beforeunload', () => void flushPersistence());
}

export function navigate(view: View): void {
  app.set({ view });
  updateSettings({ lastView: view });
}
