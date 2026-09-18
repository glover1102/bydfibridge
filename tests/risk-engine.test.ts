import { describe, expect, it } from 'vitest';
import { RiskEngine } from '../src/risk/risk-engine.js';
import { createTestConfig } from './helpers.js';

describe('RiskEngine', () => {
  it('accepts risk-based sizing math', () => {
    const config = createTestConfig();
    config.maxPositionSize['BTC-USDT'] = 10;
    const engine = new RiskEngine(config, { getDailyPnl: () => 0 });
    const prepared = engine.prepareTrade({
      token: 'secret',
      strategy: 'test',
      signal_id: 'a',
      action: 'entry',
      side: 'long',
      symbol: 'BTCUSDT',
      leverage: 10,
      risk_percent: 0.5,
      order_type: 'market',
      entry: 100,
      stop_loss: 90,
      takeProfits: [{ name: 'tp1', price: 110 }],
      move_sl_to_be_after: 'tp1',
      reverse_on_opposite: true
    }, { equity: 10_000, availableBalance: 2_000 }, []);

    expect(prepared.qty).toBe(5);
  });

  it('rejects leverage over cap', () => {
    const config = createTestConfig();
    const engine = new RiskEngine(config, { getDailyPnl: () => 0 });
    expect(() => engine.prepareTrade({
      token: 'secret',
      strategy: 'test',
      signal_id: 'a',
      action: 'entry',
      side: 'long',
      symbol: 'BTCUSDT',
      leverage: 11,
      qty: 0.1,
      order_type: 'market',
      entry: 100,
      stop_loss: 90,
      takeProfits: [],
      move_sl_to_be_after: 'none',
      reverse_on_opposite: false
    }, { equity: 10_000, availableBalance: 2_000 }, [])).toThrow(/exceeds cap/);
  });

  it('rejects daily loss breaches and max positions', () => {
    const config = createTestConfig();
    const lossEngine = new RiskEngine(config, { getDailyPnl: () => -600 });
    expect(() => lossEngine.prepareTrade({
      token: 'secret',
      strategy: 'test',
      signal_id: 'a',
      action: 'entry',
      side: 'long',
      symbol: 'BTCUSDT',
      leverage: 10,
      qty: 0.1,
      order_type: 'market',
      entry: 100,
      stop_loss: 90,
      takeProfits: [],
      move_sl_to_be_after: 'none',
      reverse_on_opposite: false
    }, { equity: 10_000, availableBalance: 2_000 }, [])).toThrow(/Daily loss/);

    const positionsEngine = new RiskEngine(config, { getDailyPnl: () => 0 });
    expect(() => positionsEngine.prepareTrade({
      token: 'secret',
      strategy: 'test',
      signal_id: 'a',
      action: 'entry',
      side: 'long',
      symbol: 'BTCUSDT',
      leverage: 10,
      qty: 0.1,
      order_type: 'market',
      entry: 100,
      stop_loss: 90,
      takeProfits: [],
      move_sl_to_be_after: 'none',
      reverse_on_opposite: false
    }, { equity: 10_000, availableBalance: 2_000 }, [
      { symbol: 'ETH-USDT', side: 'long', qty: 1, entryPrice: 10 },
      { symbol: 'SOL-USDT', side: 'short', qty: 1, entryPrice: 10 },
      { symbol: 'XRP-USDT', side: 'short', qty: 1, entryPrice: 10 }
    ])).toThrow(/Max open positions/);
  });

  it('rejects symbols without a configured spec', () => {
    const config = createTestConfig();
    config.symbolSpecs = {};
    const engine = new RiskEngine(config, { getDailyPnl: () => 0 });

    expect(() => engine.prepareTrade({
      token: 'secret',
      strategy: 'test',
      signal_id: 'missing-spec',
      action: 'entry',
      side: 'long',
      symbol: 'BTCUSDT',
      leverage: 10,
      qty: 0.1,
      order_type: 'market',
      entry: 100,
      stop_loss: 90,
      takeProfits: [],
      move_sl_to_be_after: 'none',
      reverse_on_opposite: false
    }, { equity: 10_000, availableBalance: 2_000 }, [])).toThrow(/No symbol spec configured/);
  });
});
