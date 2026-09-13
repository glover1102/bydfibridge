import { BydfiClient, type BydfiClientLike, toPositionSide } from '../bydfi/client.js';
import type { AppConfig } from '../config/env.js';
import type { MoveSlToBeAfter, TradeRecord, TradingViewSignal } from './types.js';
import { RiskEngine } from '../risk/risk-engine.js';
import { TradeStore } from '../store/trade-store.js';
import type { LogStore } from '../store/log-store.js';
import type { Notifier } from '../notify/discord.js';
import { normalizeTradingViewSymbol } from '../webhook/symbols.js';

export class TradeOrchestrator {
  constructor(
    private readonly config: AppConfig,
    private readonly bydfiClient: BydfiClientLike,
    private readonly riskEngine: RiskEngine,
    private readonly tradeStore: TradeStore,
    private readonly logStore: LogStore,
    private readonly notifier: Notifier
  ) {}

  async process(signal: TradingViewSignal): Promise<void> {
    const mappedSymbol = normalizeTradingViewSymbol(signal.symbol, this.config.symbolMap);
    if (signal.action === 'close_all') {
      await this.closeAllPositions();
      return;
    }

    if (signal.action === 'exit') {
      await this.exitSymbol(mappedSymbol);
      return;
    }

    let positions = await this.bydfiClient.getPositions();
    const existing = positions.find((position) => position.symbol === mappedSymbol);

    if (existing) {
      if (!signal.side) {
        throw new Error('side is required for entry signals');
      }
      if (existing.side !== signal.side) {
        if (!signal.reverse_on_opposite) {
          this.logStore.add('info', 'Skipping opposite-side signal because reverse_on_opposite=false', { signalId: signal.signal_id, symbol: mappedSymbol });
          return;
        }
        await this.bydfiClient.cancelAllOrders(mappedSymbol);
        if (this.bydfiClient instanceof BydfiClient) {
          await this.bydfiClient.closePositionMarket(mappedSymbol, existing.side, existing.qty);
        } else {
          await this.bydfiClient.placeOrder({
            symbol: mappedSymbol,
            side: existing.side === 'long' ? 'sell' : 'buy',
            orderType: 'MARKET',
            qty: existing.qty,
            reduceOnly: true,
            closePosition: true,
            positionSide: toPositionSide(existing.side)
          });
        }
        positions = await this.bydfiClient.getPositions();
        if (positions.some((position) => position.symbol === mappedSymbol && position.side === existing.side)) {
          throw new Error('Opposite position still open after close attempt');
        }
      } else if (!this.config.allowPyramiding) {
        this.logStore.add('info', 'Skipping same-side signal because pyramiding is disabled', { signalId: signal.signal_id, symbol: mappedSymbol });
        return;
      }
    }

    const balance = await this.bydfiClient.getBalance();
    const prepared = this.riskEngine.prepareTrade(signal, balance, positions.filter((position) => position.symbol !== mappedSymbol));

    await this.bydfiClient.setMarginMode(prepared.symbol, this.config.marginMode);
    await this.bydfiClient.setLeverage(prepared.symbol, prepared.leverage);

    const entryOrder = await this.bydfiClient.placeOrder({
      symbol: prepared.symbol,
      side: prepared.side === 'long' ? 'buy' : 'sell',
      orderType: prepared.orderType === 'market' ? 'MARKET' : 'LIMIT',
      qty: prepared.qty,
      price: prepared.orderType === 'limit' ? prepared.entry : undefined,
      positionSide: toPositionSide(prepared.side)
    });
    const filledOrder = await this.bydfiClient.getOrder(prepared.symbol, entryOrder.id) ?? entryOrder;
    const entryFillPrice = filledOrder.avgFillPrice && filledOrder.avgFillPrice > 0 ? filledOrder.avgFillPrice : prepared.entry;
    const filledQty = filledOrder.filledQty && filledOrder.filledQty > 0 ? filledOrder.filledQty : prepared.qty;

    if (prepared.orderType === 'limit' && (!filledOrder.filledQty || filledOrder.filledQty <= 0)) {
      await this.bydfiClient.cancelOrder(prepared.symbol, entryOrder.id);
      throw new Error('Limit entry did not fill immediately; order cancelled to avoid unmanaged exposure');
    }

    if (prepared.orderType === 'limit' && filledQty < prepared.qty) {
      await this.bydfiClient.cancelOrder(prepared.symbol, entryOrder.id);
    }

    const stopLossOrder = await this.bydfiClient.placeOrder({
      symbol: prepared.symbol,
      side: prepared.side === 'long' ? 'sell' : 'buy',
      orderType: 'STOP_MARKET',
      qty: filledQty,
      triggerPrice: prepared.stopLoss,
      reduceOnly: true,
      positionSide: toPositionSide(prepared.side)
    });

    const takeProfitOrders = prepared.takeProfits.length > 0
      ? await this.bydfiClient.batchPlaceOrders(prepared.takeProfits.map((takeProfit) => ({
          symbol: prepared.symbol,
          side: prepared.side === 'long' ? 'sell' : 'buy',
          orderType: 'TAKE_PROFIT_MARKET',
          qty: takeProfit.qty,
          triggerPrice: takeProfit.price,
          reduceOnly: true,
          positionSide: toPositionSide(prepared.side)
        })))
      : [];

    const tradeRecord: TradeRecord = {
      signalId: signal.signal_id,
      strategy: signal.strategy,
      symbol: prepared.symbol,
      side: prepared.side,
      leverage: prepared.leverage,
      entryOrderId: entryOrder.id,
      entryFillPrice,
      entryFilledQty: filledQty,
      stopLossOrderId: stopLossOrder.id,
      stopLossPrice: prepared.stopLoss,
      takeProfitOrderIds: {},
      takeProfitPrices: {},
      takeProfitQtys: {},
      moveSlToBeAfter: signal.move_sl_to_be_after,
      breakevenMoved: signal.move_sl_to_be_after === 'none',
      status: 'open',
      openedAt: new Date().toISOString(),
      remainingQty: filledQty
    };

    prepared.takeProfits.forEach((takeProfit, index) => {
      const order = takeProfitOrders[index];
      if (!order) {
        return;
      }
      tradeRecord.takeProfitOrderIds[takeProfit.name] = order.id;
      tradeRecord.takeProfitPrices[takeProfit.name] = takeProfit.price;
      tradeRecord.takeProfitQtys[takeProfit.name] = takeProfit.qty;
    });

    this.tradeStore.upsertTrade(tradeRecord);
    this.logStore.add('info', 'Entry filled and protective orders placed', { signalId: signal.signal_id, symbol: prepared.symbol, qty: filledQty });
    await this.notifier.notify('Entry filled', { signalId: signal.signal_id, symbol: prepared.symbol, qty: filledQty, entryFillPrice, stopLoss: prepared.stopLoss, takeProfits: prepared.takeProfits });
  }

  private async exitSymbol(symbol: string): Promise<void> {
    await this.bydfiClient.cancelAllOrders(symbol);
    const positions = await this.bydfiClient.getPositions();
    const position = positions.find((candidate) => candidate.symbol === symbol);
    if (!position) {
      return;
    }
    if (this.bydfiClient instanceof BydfiClient) {
      await this.bydfiClient.closePositionMarket(symbol, position.side, position.qty);
    } else {
      await this.bydfiClient.placeOrder({
        symbol,
        side: position.side === 'long' ? 'sell' : 'buy',
        orderType: 'MARKET',
        qty: position.qty,
        reduceOnly: true,
        closePosition: true,
        positionSide: toPositionSide(position.side)
      });
    }
    this.logStore.add('info', 'Exit signal executed', { symbol });
  }

  private async closeAllPositions(): Promise<void> {
    const positions = await this.bydfiClient.getPositions();
    for (const position of positions) {
      await this.exitSymbol(position.symbol);
    }
    this.logStore.add('warn', 'close_all executed', { count: positions.length });
  }
}

export const shouldMoveStopToBreakeven = (trade: TradeRecord): trade is TradeRecord & { moveSlToBeAfter: Exclude<MoveSlToBeAfter, 'none'> } => trade.moveSlToBeAfter !== 'none';
