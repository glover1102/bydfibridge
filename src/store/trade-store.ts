import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TradeRecord } from '../execution/types.js';

interface TradeStoreState {
  trades: TradeRecord[];
  dailyPnlByDate: Record<string, number>;
}

const getUtcDayKey = (date = new Date()): string => date.toISOString().slice(0, 10);

export class TradeStore {
  private readonly state: TradeStoreState;

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.state = existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, 'utf8')) as TradeStoreState
      : { trades: [], dailyPnlByDate: {} };
  }

  upsertTrade(trade: TradeRecord): void {
    const index = this.state.trades.findIndex((candidate) => candidate.signalId === trade.signalId);
    if (index >= 0) {
      this.state.trades[index] = trade;
    } else {
      this.state.trades.push(trade);
    }
    this.persist();
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
    const index = this.state.trades.findIndex((trade) => trade.signalId === signalId);
    if (index < 0) {
      return undefined;
    }
    const updated = updater(this.state.trades[index]);
    this.state.trades[index] = updated;
    this.persist();
    return updated;
  }

  addDailyPnl(amount: number, date = getUtcDayKey()): number {
    this.state.dailyPnlByDate[date] = (this.state.dailyPnlByDate[date] ?? 0) + amount;
    this.persist();
    return this.state.dailyPnlByDate[date];
  }

  getDailyPnl(date = getUtcDayKey()): number {
    return this.state.dailyPnlByDate[date] ?? 0;
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }
}
