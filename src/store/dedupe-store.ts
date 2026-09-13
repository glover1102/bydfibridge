import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface DedupeState {
  signals: Record<string, number>;
}

export interface DedupeStore {
  reserve(signalId: string): boolean;
}

export class PersistentDedupeStore implements DedupeStore {
  private readonly state: DedupeState;

  constructor(private readonly filePath: string, private readonly ttlMs: number) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.state = existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, 'utf8')) as DedupeState
      : { signals: {} };
    this.cleanup();
  }

  reserve(signalId: string): boolean {
    this.cleanup();
    if (this.state.signals[signalId]) {
      return false;
    }
    this.state.signals[signalId] = Date.now() + this.ttlMs;
    this.persist();
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [signalId, expiresAt] of Object.entries(this.state.signals)) {
      if (expiresAt <= now) {
        delete this.state.signals[signalId];
      }
    }
    this.persist();
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }
}
