import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSymbolSpecsFromExchange, mergeSymbolSpecs } from '../src/bydfi/symbol-specs.js';
import type { BydfiClientLike } from '../src/bydfi/client.js';

const createClient = (exchangeInfo: Record<string, unknown>): BydfiClientLike => ({
  setLeverage: async () => undefined,
  setMarginMode: async () => undefined,
  placeOrder: async () => {
    throw new Error('not implemented');
  },
  batchPlaceOrders: async () => {
    throw new Error('not implemented');
  },
  cancelOrder: async () => undefined,
  cancelAllOrders: async () => undefined,
  modifyOrder: async () => undefined,
  getPositions: async () => [],
  getOpenOrders: async () => [],
  getBalance: async () => ({ equity: 0, availableBalance: 0 }),
  getOrder: async () => undefined,
  getExchangeInfo: async () => exchangeInfo
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadSymbolSpecsFromExchange', () => {
  it('parses step-based exchange payloads', async () => {
    const symbolSpecs = await loadSymbolSpecsFromExchange(createClient({
      data: {
        symbols: [
          { symbol: 'BTC-USDT', stepSize: '0.001', tickSize: '0.1' }
        ]
      }
    }));

    expect(symbolSpecs).toEqual({
      'BTC-USDT': { qtyStep: 0.001, priceTick: 0.1 }
    });
  });

  it('parses precision-based exchange payloads', async () => {
    const symbolSpecs = await loadSymbolSpecsFromExchange(createClient({
      list: [
        { symbol: 'ETH-USDT', quantityPrecision: 3, pricePrecision: 2 }
      ]
    }));

    expect(symbolSpecs).toEqual({
      'ETH-USDT': { qtyStep: 0.001, priceTick: 0.01 }
    });
  });

  it('skips unparseable entries and logs a warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const symbolSpecs = await loadSymbolSpecsFromExchange(createClient({
      symbols: [
        { symbol: 'BTC-USDT', stepSize: '0.001', tickSize: '0.1' },
        { symbol: 'BROKEN-USDT', tickSize: '0.01' },
        { foo: 'bar' }
      ]
    }));

    expect(symbolSpecs).toEqual({
      'BTC-USDT': { qtyStep: 0.001, priceTick: 0.1 }
    });
    expect(warnSpy).toHaveBeenCalledWith('Skipped unparseable exchange symbol specs: BROKEN-USDT, entry#3');
  });

  it('keeps env specs ahead of exchange specs when merged', () => {
    expect(mergeSymbolSpecs(
      {
        'BTC-USDT': { qtyStep: 0.01, priceTick: 0.5 },
        'ETH-USDT': { qtyStep: 0.01, priceTick: 0.01 }
      },
      {
        'BTC-USDT': { qtyStep: 0.001, priceTick: 0.1 }
      }
    )).toEqual({
      'BTC-USDT': { qtyStep: 0.001, priceTick: 0.1 },
      'ETH-USDT': { qtyStep: 0.01, priceTick: 0.01 }
    });
  });
});
