import type { RenderOptions } from '../../shared/export/render';
import type { Session } from '../../shared/types';
import { api } from '../api';
import type { FromWorker, ToWorker } from './export.worker';

export interface ExportJob {
  promise: Promise<{ path: string; fileName: string; bytes: number } | null>;
  cancel(): void;
}

/**
 * Run an export: ask main for a destination (save dialog), render in a worker,
 * stream bytes to disk. Resolves null if the user cancelled the dialog.
 */
export function startExport(
  session: Session,
  options: RenderOptions,
  fileName: string,
  onProgress: (f: number) => void,
): ExportJob {
  let worker: Worker | null = null;
  let token: string | null = null;
  let cancelled = false;
  let rejectFn: ((e: Error) => void) | null = null;

  const promise = (async () => {
    const target = await api.export.begin(fileName, options.format);
    if (!target) return null;
    token = target.token;
    if (cancelled) {
      await api.export.abort(token);
      return null;
    }
    const w = new Worker('export-worker.js');
    worker = w;
    try {
      await new Promise<void>((resolve, reject) => {
        rejectFn = reject;
        w.onerror = (e) => reject(new Error(e.message || 'worker error'));
        w.onmessage = async (e: MessageEvent<FromWorker>) => {
          const m = e.data;
          try {
            if (m.type === 'write') {
              await api.export.write(target.token, m.bytes);
              w.postMessage({ type: 'ack', id: m.id } satisfies ToWorker);
            } else if (m.type === 'patch') {
              await api.export.patch(target.token, m.offset, m.bytes);
              w.postMessage({ type: 'ack', id: m.id } satisfies ToWorker);
            } else if (m.type === 'progress') onProgress(m.fraction);
            else if (m.type === 'done') resolve();
            else if (m.type === 'error') reject(new Error(m.message));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        };
        w.postMessage({ type: 'start', session, options } satisfies ToWorker);
      });
      return await api.export.finish(target.token);
    } catch (err) {
      await api.export.abort(target.token);
      throw err;
    } finally {
      w.terminate();
      worker = null;
    }
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      worker?.postMessage({ type: 'cancel' } satisfies ToWorker);
      rejectFn?.(new Error('CANCELLED'));
      if (token) void api.export.abort(token);
    },
  };
}
