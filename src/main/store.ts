/**
 * Crash-safe JSON persistence (no Electron imports → unit-testable in Node).
 *
 *  - writes go to `<file>.tmp`, are fsync'ed, then atomically renamed;
 *  - the previous good version is kept as `<file>.bak`;
 *  - on a corrupt/unreadable file the backup is used, and the broken file is kept
 *    aside as `<file>.corrupt-<timestamp>` for inspection;
 *  - concurrent saves are serialised; the latest value always wins.
 */
import { promises as fsp, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export class JsonStore<T> {
  private readonly path: string;
  private chain: Promise<void> = Promise.resolve();
  private pending: T | null = null;
  lastError: string | null = null;
  recoveredFrom: 'backup' | 'defaults' | null = null;

  constructor(
    private readonly dir: string,
    private readonly name: string,
    private readonly sanitize: (v: unknown) => T,
  ) {
    this.path = join(dir, name);
  }

  get filePath(): string {
    return this.path;
  }

  load(): T {
    mkdirSync(this.dir, { recursive: true });
    const tryRead = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
    if (existsSync(this.path)) {
      try {
        return this.sanitize(tryRead(this.path));
      } catch (e) {
        this.lastError = String(e);
        try {
          renameSync(this.path, `${this.path}.corrupt-${Date.now()}`);
        } catch {
          /* ignore */
        }
      }
    }
    const bak = `${this.path}.bak`;
    if (existsSync(bak)) {
      try {
        const v = this.sanitize(tryRead(bak));
        this.recoveredFrom = 'backup';
        return v;
      } catch (e) {
        this.lastError = String(e);
      }
    }
    if (this.lastError) this.recoveredFrom = 'defaults';
    return this.sanitize(undefined);
  }

  /** Queue a save; resolves when this (or a newer) value is on disk. */
  save(value: T): Promise<void> {
    this.pending = value;
    this.chain = this.chain.then(() => this.flush()).catch((e) => {
      this.lastError = String(e);
    });
    return this.chain;
  }

  private async flush(): Promise<void> {
    if (this.pending === null) return;
    const value = this.pending;
    this.pending = null;
    await fsp.mkdir(this.dir, { recursive: true });
    const json = JSON.stringify(value, null, 2);
    const tmp = `${this.path}.tmp`;
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(json, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (existsSync(this.path)) {
      try {
        await fsp.copyFile(this.path, `${this.path}.bak`);
      } catch {
        /* a missing backup is not fatal */
      }
    }
    await fsp.rename(tmp, this.path);
  }

  /** Wait for all queued writes (used on quit). */
  async idle(): Promise<void> {
    await this.chain;
  }

  async remove(): Promise<void> {
    await this.idle();
    for (const p of [this.path, `${this.path}.bak`, `${this.path}.tmp`]) await fsp.rm(p, { force: true });
  }
}
