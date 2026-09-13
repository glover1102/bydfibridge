import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TradeRecord } from '../execution/types.js';

interface TradeStoreState {
  trades: TradeRecord[];
  dailyPnlByDate: Record<string, number>;
}

const getUtcDayKey = (date = new Date()): string => date.toISOString().slice(0, 10);

export class TradeStore {
  private readonly state: TradeStoreState;
  private readonly lockFilePath: string;

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.lockFilePath = `${filePath}.lock`;
    this.state = existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, 'utf8')) as TradeStoreState
      : { trades: [], dailyPnlByDate: {} };
  }

  upsertTrade(trade: TradeRecord): void {
    this.withLock(() => {
      this.reload();
      const index = this.state.trades.findIndex((candidate) => candidate.signalId === trade.signalId);
      if (index >= 0) {
        this.state.trades[index] = trade;
      } else {
        this.state.trades.push(trade);
      }
      this.persist();
    });
  }

  listTrades(): TradeRecord[] {
    return [...this.state.trades];
  }

  listOpenTrades(): TradeRecord[] {
    return this.state.trades.filter((trade) => trade.status === 'open');
  }

  getOpenTradeForSymbol(symbol: string): TradeRecord | undefined {
    return this.state.trades.find((trade) => trade.symbol === symbol && trade.status === 'open');
  }

  updateTrade(signalId: string, updater: (trade: TradeRecord) => TradeRecord): TradeRecord | undefined {
    return this.withLock(() => {
      this.reload();
      const index = this.state.trades.findIndex((trade) => trade.signalId === signalId);
      if (index < 0) {
        return undefined;
      }
      const updated = updater(this.state.trades[index]);
      this.state.trades[index] = updated;
      this.persist();
      return updated;
    });
  }

  addDailyPnl(amount: number, date = getUtcDayKey()): number {
    return this.withLock(() => {
      this.reload();
      this.state.dailyPnlByDate[date] = (this.state.dailyPnlByDate[date] ?? 0) + amount;
      this.persist();
      return this.state.dailyPnlByDate[date];
    });
  }

  getDailyPnl(date = getUtcDayKey()): number {
    return this.state.dailyPnlByDate[date] ?? 0;
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  private reload(): void {
    if (!existsSync(this.filePath)) {
      this.state.trades = [];
      this.state.dailyPnlByDate = {};
      return;
    }
    const latest = JSON.parse(readFileSync(this.filePath, 'utf8')) as TradeStoreState;
    this.state.trades = latest.trades ?? [];
    this.state.dailyPnlByDate = latest.dailyPnlByDate ?? {};
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
