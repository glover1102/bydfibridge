import type { AppConfig } from '../config/env.js';
import type { BalanceSnapshot, PositionSnapshot, PreparedTrade, SymbolSpec, TakeProfitLevel, TradeSide, TradingViewSignal } from '../execution/types.js';
import { normalizeTradingViewSymbol } from '../webhook/symbols.js';
import { TradeStore } from '../store/trade-store.js';

const roundToStep = (value: number, step: number): number => {
  const precision = Math.max(0, `${step}`.split('.')[1]?.length ?? 0);
  return Number((Math.floor(value / step) * step).toFixed(precision));
};

const validateTakeProfitSide = (side: TradeSide, entry: number, takeProfits: TakeProfitLevel[]): void => {
  for (const takeProfit of takeProfits) {
    if (side === 'long' && takeProfit.price <= entry) {
      throw new Error(`${takeProfit.name} must be above entry for long positions`);
    }
    if (side === 'short' && takeProfit.price >= entry) {
      throw new Error(`${takeProfit.name} must be below entry for short positions`);
    }
  }
};

const validateStopLossSide = (side: TradeSide, entry: number, stopLoss: number): void => {
  if (side === 'long' && stopLoss >= entry) {
    throw new Error('stop_loss must be below entry for long positions');
  }
  if (side === 'short' && stopLoss <= entry) {
    throw new Error('stop_loss must be above entry for short positions');
  }
};

const evenSplitTakeProfits = (qty: number, takeProfits: TakeProfitLevel[], step: number): Array<Required<TakeProfitLevel>> => {
  if (takeProfits.length === 0) {
    return [];
  }
  const explicitTotal = takeProfits.reduce((sum, tp) => sum + (tp.qty ?? 0), 0);
  if (explicitTotal > qty) {
    throw new Error('sum of tp quantities exceeds qty');
  }

  const missingQtyLevels = takeProfits.filter((tp) => tp.qty === undefined);
  const remainingQty = qty - explicitTotal;
  const splitQty = missingQtyLevels.length > 0 ? remainingQty / missingQtyLevels.length : 0;

  let assignedTotal = 0;
  return takeProfits.map((tp, index) => {
    const isLast = index === takeProfits.length - 1;
    const rawQty = tp.qty ?? splitQty;
    const roundedQty = isLast ? roundToStep(qty - assignedTotal, step) : roundToStep(rawQty, step);
    assignedTotal += roundedQty;
    return { ...tp, qty: roundedQty };
  });
};

export class RiskEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly tradeStore: Pick<TradeStore, 'getDailyPnl'>,
    private readonly isTradingEnabled: () => boolean = () => config.tradingEnabled
  ) {}

  getSymbolSpec(symbol: string): SymbolSpec {
    const spec = this.config.symbolSpecs[symbol];
    if (!spec) {
      throw new Error(`No symbol spec configured for ${symbol}`);
    }
    return spec;
  }

  prepareTrade(signal: TradingViewSignal, balance: BalanceSnapshot, openPositions: PositionSnapshot[]): PreparedTrade {
    if (!this.isTradingEnabled()) {
      throw new Error('Trading is disabled');
    }
    if (signal.action !== 'entry' || !signal.side || signal.entry === undefined) {
      throw new Error('Only entry signals can be prepared');
    }

    const symbol = normalizeTradingViewSymbol(signal.symbol, this.config.symbolMap);
    const leverage = this.resolveLeverage(symbol, signal.leverage ?? 1);
    const stopLoss = signal.stop_loss;

    if (this.config.requireStopLoss && stopLoss === undefined) {
      throw new Error('stop_loss is required');
    }
    if (this.config.requireTakeProfit && signal.takeProfits.length === 0) {
      throw new Error('At least one take profit is required');
    }
    if (stopLoss === undefined) {
      throw new Error('stop_loss is required');
    }

    validateStopLossSide(signal.side, signal.entry, stopLoss);
    validateTakeProfitSide(signal.side, signal.entry, signal.takeProfits);

    if (this.config.maxDailyLossUsdt !== undefined && this.tradeStore.getDailyPnl() <= -this.config.maxDailyLossUsdt) {
      throw new Error('Daily loss limit breached');
    }
    if (openPositions.length >= this.config.maxOpenPositions) {
      throw new Error('Max open positions reached');
    }

    const spec = this.getSymbolSpec(symbol);
    const qty = roundToStep(this.resolveQty(signal, balance, signal.entry, stopLoss), spec.qtyStep);
    if (qty <= 0) {
      throw new Error('Calculated qty rounds to zero');
    }

    const maxPositionSize = this.config.maxPositionSize[symbol];
    if (maxPositionSize !== undefined && qty > maxPositionSize) {
      throw new Error(`Position size exceeds cap for ${symbol}`);
    }

    const initialMargin = (qty * signal.entry) / leverage;
    if (initialMargin > balance.availableBalance) {
      throw new Error('Insufficient available balance for requested position');
    }

    const takeProfits = evenSplitTakeProfits(qty, signal.takeProfits, spec.qtyStep);
    return {
      symbol,
      side: signal.side,
      leverage,
      qty,
      entry: signal.entry,
      stopLoss,
      takeProfits,
      orderType: signal.order_type
    };
  }

  private resolveLeverage(symbol: string, requestedLeverage: number): number {
    const symbolCap = this.config.symbolLeverageCaps[symbol] ?? this.config.maxLeverage;
    const effectiveCap = Math.min(symbolCap, this.config.maxLeverage);
    if (requestedLeverage <= effectiveCap) {
      return requestedLeverage;
    }
    if (this.config.leverageExceedAction === 'clamp') {
      return effectiveCap;
    }
    throw new Error(`Requested leverage ${requestedLeverage} exceeds cap ${effectiveCap} for ${symbol}`);
  }

  private resolveQty(signal: TradingViewSignal, balance: BalanceSnapshot, entry: number, stopLoss: number): number {
    if (signal.risk_percent !== undefined) {
      const riskAmount = balance.equity * (signal.risk_percent / 100);
      const distance = Math.abs(entry - stopLoss);
      if (distance === 0) {
        throw new Error('entry and stop_loss cannot be equal for risk sizing');
      }
      return riskAmount / distance;
    }
    if (signal.qty === undefined) {
      throw new Error('qty is required when risk_percent is not provided');
    }
    return signal.qty;
  }
}
