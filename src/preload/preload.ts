/**
 * The only bridge between the sandboxed UI and the system. Every call is a
 * narrow, typed, validated IPC invocation — no generic channel access.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfo, Library, Settings } from '../shared/types';

const api = {
  platform: process.platform,
  info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  load: (): Promise<{
    settings: Settings;
    library: Library;
    recovered: 'backup' | 'defaults' | null;
    portableFallback: boolean;
  }> => ipcRenderer.invoke('store:load'),
  saveSettings: (s: Settings): Promise<void> => ipcRenderer.invoke('store:saveSettings', s),
  saveLibrary: (l: Library): Promise<void> => ipcRenderer.invoke('store:saveLibrary', l),
  resetAll: (): Promise<void> => ipcRenderer.invoke('store:resetAll'),
  export: {
    begin: (name: string, format: string): Promise<{ token: string; fileName: string } | null> =>
      ipcRenderer.invoke('export:begin', name, format),
    write: (token: string, bytes: Uint8Array): Promise<void> => ipcRenderer.invoke('export:write', token, bytes),
    patch: (token: string, offset: number, bytes: Uint8Array): Promise<void> =>
      ipcRenderer.invoke('export:patch', token, offset, bytes),
    finish: (token: string): Promise<{ path: string; fileName: string; bytes: number }> =>
      ipcRenderer.invoke('export:finish', token),
    abort: (token: string): Promise<void> => ipcRenderer.invoke('export:abort', token),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke('export:reveal', path),
  },
  presets: {
    save: (json: string, name: string): Promise<boolean> => ipcRenderer.invoke('presets:save', json, name),
    open: (): Promise<string | null> => ipcRenderer.invoke('presets:open'),
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('app:openDataFolder'),
  setPlaying: (playing: boolean): Promise<void> => ipcRenderer.invoke('app:power', playing),
  smokeReport: (report: unknown): Promise<void> => ipcRenderer.invoke('smoke:report', report),
};

export type MindHzApi = typeof api;

contextBridge.exposeInMainWorld('mindhz', api);
