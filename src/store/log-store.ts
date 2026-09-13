export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export class LogStore {
  private readonly entries: LogEntry[] = [];

  constructor(private readonly limit: number) {}

  add(level: LogEntry['level'], message: string, context?: Record<string, unknown>): void {
    this.entries.push({ level, message, context, timestamp: new Date().toISOString() });
    while (this.entries.length > this.limit) {
      this.entries.shift();
    }
  }

  list(): LogEntry[] {
    return [...this.entries].reverse();
  }
}
