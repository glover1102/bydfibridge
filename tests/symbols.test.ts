import { describe, expect, it } from 'vitest';
import { normalizeTradingViewSymbol } from '../src/webhook/symbols.js';

describe('normalizeTradingViewSymbol', () => {
  it.each([
    ['BYDFI:BTCUSDT.P', 'BTC-USDT'],
    ['BINANCE:BTCUSDT.P', 'BTC-USDT'],
    ['BTCUSDT.P', 'BTC-USDT'],
    ['BTCUSDT', 'BTC-USDT'],
    ['BTCUSD', 'BTC-USDT']
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeTradingViewSymbol(input, {})).toBe(expected);
  });

  it('applies overrides before fallback parsing', () => {
    expect(normalizeTradingViewSymbol('FOO', { FOO: 'SOL-USDT' })).toBe('SOL-USDT');
  });
});
