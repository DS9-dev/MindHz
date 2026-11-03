/**
 * Export worker: renders + encodes off the UI thread with the same engine as the
 * player. Bytes are streamed to the main thread with back-pressure (each chunk is
 * acknowledged after it was written to disk), so memory stays flat even for
 * multi-hour sessions.
 */
import { type RenderOptions, renderToSink } from '../../shared/export/render';
import type { Session } from '../../shared/types';

export type ToWorker =
  | { type: 'start'; session: Session; options: RenderOptions }
  | { type: 'ack'; id: number }
  | { type: 'cancel' };

export type FromWorker =
  | { type: 'write'; id: number; bytes: Uint8Array }
  | { type: 'patch'; id: number; offset: number; bytes: Uint8Array }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; frames: number; bytes: number }
  | { type: 'error'; message: string };

const ctx = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

let cancelled = false;
let nextId = 1;
const waiting = new Map<number, () => void>();

function request(m: { type: 'write' | 'patch'; bytes: Uint8Array; offset?: number }): Promise<void> {
  const id = nextId++;
  return new Promise<void>((resolve) => {
    waiting.set(id, resolve);
    // copy into a standalone buffer so it can be transferred without detaching encoder memory
    const bytes = m.bytes.slice();
    if (m.type === 'write') ctx.postMessage({ type: 'write', id, bytes }, [bytes.buffer]);
    else ctx.postMessage({ type: 'patch', id, offset: m.offset ?? 0, bytes }, [bytes.buffer]);
  });
}

ctx.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'ack') {
    waiting.get(m.id)?.();
    waiting.delete(m.id);
    return;
  }
  if (m.type === 'cancel') {
    cancelled = true;
    for (const r of waiting.values()) r();
    waiting.clear();
    return;
  }
  if (m.type === 'start') {
    cancelled = false;
    try {
      const r = await renderToSink(
        m.session,
        m.options,
        {
          write: (bytes) => request({ type: 'write', bytes }),
          patch: (offset, bytes) => request({ type: 'patch', bytes, offset }),
        },
        (fraction) => ctx.postMessage({ type: 'progress', fraction }),
        () => cancelled,
      );
      ctx.postMessage({ type: 'done', frames: r.frames, bytes: r.bytes });
    } catch (err) {
      ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
};
