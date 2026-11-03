import type { MindHzApi } from '../preload/preload';

declare global {
  interface Window {
    mindhz: MindHzApi;
  }
  const __APP_VERSION__: string;
}

export const api: MindHzApi = window.mindhz;
