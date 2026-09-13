import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface DedupeState {
  signals: Record<string, number>;
}

export interface DedupeStore {
  reserve(signalId: string): boolean;
}

export class PersistentDedupeStore implements DedupeStore {
  private readonly state: DedupeState;
  private readonly lockFilePath: string;

  constructor(private readonly filePath: string, private readonly ttlMs: number) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.lockFilePath = `${filePath}.lock`;
    this.state = existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, 'utf8')) as DedupeState
      : { signals: {} };
    this.cleanup();
  }

  reserve(signalId: string): boolean {
    return this.withLock(() => {
      this.reload();
      this.cleanup(false);
      if (this.state.signals[signalId]) {
        return false;
      }
      this.state.signals[signalId] = Date.now() + this.ttlMs;
      this.persist();
      return true;
    });
  }

  private cleanup(shouldPersist = true): void {
    const now = Date.now();
    for (const [signalId, expiresAt] of Object.entries(this.state.signals)) {
      if (expiresAt <= now) {
        delete this.state.signals[signalId];
      }
    }
    if (shouldPersist) {
      this.persist();
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  private reload(): void {
    if (!existsSync(this.filePath)) {
      this.state.signals = {};
      return;
    }
    const latest = JSON.parse(readFileSync(this.filePath, 'utf8')) as DedupeState;
    this.state.signals = latest.signals ?? {};
  }

  private withLock<T>(action: () => T): T {
    for (;;) {
      try {
        const fd = openSync(this.lockFilePath, 'wx');
        try {
          return action();
        } finally {
          closeSync(fd);
          rmSync(this.lockFilePath, { force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }
}
