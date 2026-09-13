import type { AppConfig } from '../config/env.js';
import type { TradingViewSignal } from '../execution/types.js';
import { normalizeTradingViewSymbol } from './symbols.js';

export const validateSignalInput = (signal: TradingViewSignal, config: Pick<AppConfig, 'requireStopLoss' | 'requireTakeProfit' | 'symbolMap'>): void => {
  normalizeTradingViewSymbol(signal.symbol, config.symbolMap);

  if (signal.action !== 'entry' || !signal.side || !signal.entry) {
    return;
  }

  if (config.requireStopLoss && signal.stop_loss === undefined) {
    throw new Error('stop_loss is required');
  }
  if (config.requireTakeProfit && signal.takeProfits.length === 0) {
    throw new Error('At least one take profit is required');
  }
  if (signal.stop_loss === undefined) {
    return;
  }

  if (signal.side === 'long' && signal.stop_loss >= signal.entry) {
    throw new Error('stop_loss must be below entry for long positions');
  }
  if (signal.side === 'short' && signal.stop_loss <= signal.entry) {
    throw new Error('stop_loss must be above entry for short positions');
  }

  let explicitTpQty = 0;
  for (const takeProfit of signal.takeProfits) {
    if (signal.side === 'long' && takeProfit.price <= signal.entry) {
      throw new Error(`${takeProfit.name} must be above entry for long positions`);
    }
    if (signal.side === 'short' && takeProfit.price >= signal.entry) {
      throw new Error(`${takeProfit.name} must be below entry for short positions`);
    }
    explicitTpQty += takeProfit.qty ?? 0;
  }

  if (signal.qty !== undefined && explicitTpQty > signal.qty) {
    throw new Error('sum of tp quantities exceeds qty');
  }
};
