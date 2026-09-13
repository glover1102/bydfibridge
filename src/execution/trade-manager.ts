import type { BydfiClientLike } from '../bydfi/client.js';
import type { AppConfig } from '../config/env.js';
import type { TradeRecord } from './types.js';
import { TradeStore } from '../store/trade-store.js';
import type { LogStore } from '../store/log-store.js';
import type { Notifier } from '../notify/discord.js';
import { shouldMoveStopToBreakeven } from './orchestrator.js';
import { toPositionSide } from '../bydfi/client.js';

export class TradeManager {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: Pick<AppConfig, 'beOffsetTicks' | 'managerIntervalMs'>,
    private readonly bydfiClient: BydfiClientLike,
    private readonly tradeStore: TradeStore,
    private readonly logStore: LogStore,
    private readonly notifier: Notifier,
    private readonly getSymbolTick: (symbol: string) => number
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.managerIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick(): Promise<void> {
    const openTrades = this.tradeStore.listOpenTrades();
    for (const trade of openTrades) {
      await this.handleTrade(trade);
    }
  }

  private async handleTrade(trade: TradeRecord): Promise<void> {
    const [positions, openOrders] = await Promise.all([
      this.bydfiClient.getPositions(),
      this.bydfiClient.getOpenOrders(trade.symbol)
    ]);
    const position = positions.find((candidate) => candidate.symbol === trade.symbol && candidate.side === trade.side);
    const remainingQty = position?.qty ?? 0;

    this.tradeStore.updateTrade(trade.signalId, (current) => ({
      ...current,
      remainingQty,
      lastKnownRealizedPnl: position?.realizedPnl ?? current.lastKnownRealizedPnl
    }));

    if (shouldMoveStopToBreakeven(trade) && !trade.breakevenMoved) {
      const triggerOrderId = trade.takeProfitOrderIds[trade.moveSlToBeAfter];
      if (triggerOrderId && !openOrders.some((order) => order.id === triggerOrderId) && remainingQty > 0) {
        await this.moveStopToBreakeven(trade, remainingQty);
      }
    }

    if (remainingQty <= 0) {
      await this.closeTrade(trade, openOrders.map((order) => order.id));
    }
  }

  private async moveStopToBreakeven(trade: TradeRecord, remainingQty: number): Promise<void> {
    await this.bydfiClient.cancelOrder(trade.symbol, trade.stopLossOrderId);
    const tickSize = this.getSymbolTick(trade.symbol);
    const triggerPrice = trade.side === 'long'
      ? trade.entryFillPrice + (this.config.beOffsetTicks * tickSize)
      : trade.entryFillPrice - (this.config.beOffsetTicks * tickSize);
    const replacement = await this.bydfiClient.placeOrder({
      symbol: trade.symbol,
      side: trade.side === 'long' ? 'sell' : 'buy',
      orderType: 'STOP_MARKET',
      qty: remainingQty,
      triggerPrice,
      reduceOnly: true,
      positionSide: toPositionSide(trade.side)
    });

    this.tradeStore.updateTrade(trade.signalId, (current) => ({
      ...current,
      stopLossOrderId: replacement.id,
      stopLossPrice: triggerPrice,
      breakevenMoved: true,
      remainingQty
    }));
    this.logStore.add('info', 'Moved stop loss to breakeven', { signalId: trade.signalId, symbol: trade.symbol, triggerPrice });
    await this.notifier.notify('Moved stop to breakeven', { signalId: trade.signalId, symbol: trade.symbol, triggerPrice, remainingQty });
  }

  private async closeTrade(trade: TradeRecord, openOrderIds: string[]): Promise<void> {
    for (const orderId of openOrderIds) {
      await this.bydfiClient.cancelOrder(trade.symbol, orderId);
    }
    const realizedPnl = trade.lastKnownRealizedPnl ?? trade.realizedPnl ?? 0;
    this.tradeStore.updateTrade(trade.signalId, (current) => ({
      ...current,
      status: 'closed',
      closedAt: new Date().toISOString(),
      realizedPnl,
      remainingQty: 0
    }));
    this.tradeStore.addDailyPnl(realizedPnl);
    this.logStore.add('info', 'Trade fully closed', { signalId: trade.signalId, symbol: trade.symbol, realizedPnl });
    await this.notifier.notify('Trade closed', { signalId: trade.signalId, symbol: trade.symbol, realizedPnl });
  }
}
