import { describe, expect, it } from 'vitest';
import { loadRuntimeSymbolSpecs } from '../src/bydfi/symbol-specs.js';

describe('loadRuntimeSymbolSpecs', () => {
  it('parses symbol specs from exchange info precision fields', () => {
    expect(loadRuntimeSymbolSpecs({
      symbols: [
        { symbol: 'BTC-USDT', volumePrecision: 3, priceOrderPrecision: 1 },
        { symbol: 'ETH-USDT', qtyStep: '0.01', priceTick: '0.05' }
      ]
    })).toEqual({
      'BTC-USDT': { qtyStep: 0.001, priceTick: 0.1 },
      'ETH-USDT': { qtyStep: 0.01, priceTick: 0.05 }
    });
  });

  it('applies env overrides after loading exchange specs', () => {
    expect(loadRuntimeSymbolSpecs(
      { symbols: [{ symbol: 'BTC-USDT', volumePrecision: 3, priceOrderPrecision: 1 }] },
      { 'BTC-USDT': { qtyStep: 0.005, priceTick: 0.5 } }
    )).toEqual({
      'BTC-USDT': { qtyStep: 0.005, priceTick: 0.5 }
    });
  });
});
