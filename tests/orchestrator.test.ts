import { describe, expect, it } from 'vitest';
import { TradeOrchestrator } from '../src/execution/orchestrator.js';
import { RiskEngine } from '../src/risk/risk-engine.js';
import { TradeStore } from '../src/store/trade-store.js';
import { LogStore } from '../src/store/log-store.js';
import { TradeManager } from '../src/execution/trade-manager.js';
import { createTestConfig, MockBydfiClient } from './helpers.js';

const notifier = { notify: async () => undefined };

describe('TradeOrchestrator', () => {
  it('places long entry, stop, and take profits in sequence', async () => {
    const config = createTestConfig();
    const client = new MockBydfiClient();
    const tradeStore = new TradeStore('/tmp/bydfibridge-tests/orchestrator-long.json');
    const orchestrator = new TradeOrchestrator(config, client, new RiskEngine(config, tradeStore), tradeStore, new LogStore(50), notifier);

    await orchestrator.process({
      token: 'secret',
      strategy: 'test',
      signal_id: 'sig-1',
      action: 'entry',
      side: 'long',
      symbol: 'BYDFI:BTCUSDT.P',
      leverage: 10,
      qty: 0.05,
      order_type: 'market',
      entry: 100,
      stop_loss: 90,
      takeProfits: [
        { name: 'tp1', price: 110, qty: 0.02 },
        { name: 'tp2', price: 120, qty: 0.03 }
      ],
      move_sl_to_be_after: 'tp1',
      reverse_on_opposite: true
    });

    expect(client.marginCalls).toEqual([{ symbol: 'BTC-USDT', mode: 'isolated' }]);
    expect(client.leverageCalls).toEqual([{ symbol: 'BTC-USDT', leverage: 10 }]);
    expect(client.ordersPlaced[0]?.orderType).toBe('MARKET');
    expect(client.ordersPlaced[1]?.orderType).toBe('STOP_MARKET');
    expect(client.batchOrdersPlaced[0]?.map((order) => order.orderType)).toEqual(['TAKE_PROFIT_MARKET', 'TAKE_PROFIT_MARKET']);
  });

  it('reverses an opposite position before entering', async () => {
    const config = createTestConfig();
    const client = new MockBydfiClient();
    client.positions = [{ symbol: 'BTC-USDT', side: 'short', qty: 0.1, entryPrice: 100 }];
    const tradeStore = new TradeStore('/tmp/bydfibridge-tests/orchestrator-reverse.json');
    const orchestrator = new TradeOrchestrator(config, client, new RiskEngine(config, tradeStore), tradeStore, new LogStore(50), notifier);

    await orchestrator.process({
      token: 'secret',
      strategy: 'test',
      signal_id: 'sig-2',
      action: 'entry',
      side: 'long',
      symbol: 'BTCUSDT',
      leverage: 10,
      qty: 0.05,
      order_type: 'market',
      entry: 100,
      stop_loss: 90,
      takeProfits: [],
      move_sl_to_be_after: 'none',
      reverse_on_opposite: true
    });

    expect(client.cancelAllCalls).toContain('BTC-USDT');
    expect(client.ordersPlaced[0]).toMatchObject({ orderType: 'MARKET', reduceOnly: true, closePosition: true });
  });

  it('moves stop to breakeven after tp1 is no longer open', async () => {
    const config = createTestConfig();
    const client = new MockBydfiClient();
    const tradeStore = new TradeStore('/tmp/bydfibridge-tests/orchestrator-be.json');
    tradeStore.upsertTrade({
      signalId: 'sig-3',
      strategy: 'test',
      symbol: 'BTC-USDT',
      side: 'long',
      leverage: 10,
      entryOrderId: 'entry-1',
      entryFillPrice: 100,
      entryFilledQty: 0.05,
      stopLossOrderId: 'sl-1',
      stopLossPrice: 90,
      takeProfitOrderIds: { tp1: 'tp-1' },
      takeProfitPrices: { tp1: 110 },
      takeProfitQtys: { tp1: 0.02 },
      moveSlToBeAfter: 'tp1',
      breakevenMoved: false,
      status: 'open',
      openedAt: new Date().toISOString(),
      remainingQty: 0.05
    });
    client.positions = [{ symbol: 'BTC-USDT', side: 'long', qty: 0.03, entryPrice: 100, realizedPnl: 20 }];
    client.openOrders = [{ id: 'sl-1', symbol: 'BTC-USDT', side: 'sell', type: 'STOP_MARKET', qty: 0.05, reduceOnly: true }];

    const manager = new TradeManager(config, client, tradeStore, new LogStore(50), notifier, () => 0.1);
    await manager.tick();

    expect(client.cancelledOrders).toContainEqual({ symbol: 'BTC-USDT', orderId: 'sl-1' });
    expect(client.ordersPlaced.at(-1)).toMatchObject({ orderType: 'STOP_MARKET', triggerPrice: 100, qty: 0.03 });
  });

  it('does not move stop twice once breakeven is marked complete', async () => {
    const config = createTestConfig();
    const client = new MockBydfiClient();
    const tradeStore = new TradeStore('/tmp/bydfibridge-tests/orchestrator-be-complete.json');
    tradeStore.upsertTrade({
      signalId: 'sig-3b',
      strategy: 'test',
      symbol: 'BTC-USDT',
      side: 'long',
      leverage: 10,
      entryOrderId: 'entry-1',
      entryFillPrice: 100,
      entryFilledQty: 0.05,
      stopLossOrderId: 'sl-2',
      stopLossPrice: 100,
      takeProfitOrderIds: { tp1: 'tp-1' },
      takeProfitPrices: { tp1: 110 },
      takeProfitQtys: { tp1: 0.02 },
      moveSlToBeAfter: 'tp1',
      breakevenMoved: true,
      status: 'open',
      openedAt: new Date().toISOString(),
      remainingQty: 0.03
    });
    client.positions = [{ symbol: 'BTC-USDT', side: 'long', qty: 0.03, entryPrice: 100, realizedPnl: 20 }];
    client.openOrders = [{ id: 'sl-2', symbol: 'BTC-USDT', side: 'sell', type: 'STOP_MARKET', qty: 0.03, reduceOnly: true }];

    const manager = new TradeManager(config, client, tradeStore, new LogStore(50), notifier, () => 0.1);
    await manager.tick();

    expect(client.cancelledOrders).toHaveLength(0);
    expect(client.ordersPlaced.filter((order) => order.orderType === 'STOP_MARKET')).toHaveLength(0);
  });

  it('cancels unfilled limit entries instead of placing unmanaged exits', async () => {
    const config = createTestConfig();
    const client = new MockBydfiClient();
    client.nextEntryFilledQty = 0;
    const tradeStore = new TradeStore('/tmp/bydfibridge-tests/orchestrator-limit.json');
    const orchestrator = new TradeOrchestrator(config, client, new RiskEngine(config, tradeStore), tradeStore, new LogStore(50), notifier);

    await expect(orchestrator.process({
      token: 'secret',
      strategy: 'test',
      signal_id: 'sig-4',
      action: 'entry',
      side: 'long',
      symbol: 'BTCUSDT',
      leverage: 10,
      qty: 0.05,
      order_type: 'limit',
      entry: 100,
      stop_loss: 90,
      takeProfits: [],
      move_sl_to_be_after: 'none',
      reverse_on_opposite: false
    })).rejects.toThrow(/did not fill immediately/);

    expect(client.cancelledOrders).toContainEqual({ symbol: 'BTC-USDT', orderId: 'order-1' });
    expect(client.ordersPlaced.filter((order) => order.orderType === 'STOP_MARKET')).toHaveLength(0);
  });

  it('scales take-profit quantities to the actual partially filled limit size', async () => {
    const config = createTestConfig();
    const client = new MockBydfiClient();
    client.nextEntryFilledQty = 0.025;
    const tradeStore = new TradeStore('/tmp/bydfibridge-tests/orchestrator-limit-partial.json');
    const orchestrator = new TradeOrchestrator(config, client, new RiskEngine(config, tradeStore), tradeStore, new LogStore(50), notifier);

    await orchestrator.process({
      token: 'secret',
      strategy: 'test',
      signal_id: 'sig-5',
      action: 'entry',
      side: 'long',
      symbol: 'BTCUSDT',
      leverage: 10,
      qty: 0.05,
      order_type: 'limit',
      entry: 100,
      stop_loss: 90,
      takeProfits: [
        { name: 'tp1', price: 110, qty: 0.02 },
        { name: 'tp2', price: 120, qty: 0.03 }
      ],
      move_sl_to_be_after: 'tp1',
      reverse_on_opposite: false
    });

    expect(client.cancelledOrders).toContainEqual({ symbol: 'BTC-USDT', orderId: 'order-1' });
    expect(client.batchOrdersPlaced[0]?.map((order) => order.qty)).toEqual([0.01, 0.015]);
  });
});
