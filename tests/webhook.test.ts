import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type ExecutionQueue } from '../src/server/app.js';
import { createTestConfig } from './helpers.js';
import { LogStore } from '../src/store/log-store.js';

describe('webhook route', () => {
  const queueTasks: Array<() => Promise<void>> = [];
  const queue: ExecutionQueue = { enqueue: (task) => queueTasks.push(task) };
  const orchestrator = { process: vi.fn(async () => undefined) };
  const dedupeStore = { reserve: vi.fn(() => true) };
  const logStore = new LogStore(50);
  const config = createTestConfig();
  const app = createApp({
    config,
    dedupeStore,
    orchestrator: orchestrator as never,
    queue,
    logStore,
    getTradingEnabled: () => true,
    setTradingEnabled: () => undefined,
    getPositions: async () => [],
    getOrders: async () => []
  });

  beforeEach(() => {
    queueTasks.length = 0;
    orchestrator.process.mockClear();
    dedupeStore.reserve.mockReturnValue(true);
  });

  afterEach(async () => {
    while (queueTasks.length > 0) {
      const task = queueTasks.shift();
      if (task) {
        await task();
      }
    }
  });

  it('rejects invalid tokens', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/tradingview',
      payload: { token: 'wrong', strategy: 's', signal_id: '1', action: 'close_all', symbol: 'BTCUSDT', order_type: 'market' }
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts numbers provided as strings', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/tradingview',
      payload: {
        token: 'secret',
        strategy: 's',
        signal_id: '2',
        action: 'entry',
        side: 'long',
        symbol: 'BTCUSDT',
        leverage: '10',
        qty: '0.05',
        order_type: 'market',
        entry: '100',
        stop_loss: '90',
        tp1: '110',
        tp1_qty: '0.05'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, signal_id: '2' });
  });

  it('rejects zero values through numeric validation instead of missing-field checks', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/tradingview',
      payload: {
        token: 'secret',
        strategy: 's',
        signal_id: '2-zero',
        action: 'entry',
        side: 'long',
        symbol: 'BTCUSDT',
        leverage: '10',
        qty: '0',
        order_type: 'market',
        entry: '0',
        stop_loss: '0'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Invalid payload');
  });

  it('rejects missing stop loss, wrong-side tp, and tp qty overflow', async () => {
    const badPayloads = [
      {
        token: 'secret', strategy: 's', signal_id: '3', action: 'entry', side: 'long', symbol: 'BTCUSDT', qty: '0.05', order_type: 'market', entry: '100'
      },
      {
        token: 'secret', strategy: 's', signal_id: '4', action: 'entry', side: 'long', symbol: 'BTCUSDT', qty: '0.05', order_type: 'market', entry: '100', stop_loss: '90', tp1: '95'
      },
      {
        token: 'secret', strategy: 's', signal_id: '5', action: 'entry', side: 'long', symbol: 'BTCUSDT', qty: '0.05', order_type: 'market', entry: '100', stop_loss: '90', tp1: '110', tp1_qty: '0.04', tp2: '120', tp2_qty: '0.04'
      }
    ];

    for (const payload of badPayloads) {
      const response = await app.inject({ method: 'POST', url: '/webhook/tradingview', payload });
      expect(response.statusCode).toBe(400);
    }
  });

  it('dedupes by signal id', async () => {
    dedupeStore.reserve.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await app.inject({
      method: 'POST',
      url: '/webhook/tradingview',
      payload: { token: 'secret', strategy: 's', signal_id: 'dup', action: 'close_all', symbol: 'BTCUSDT', order_type: 'market' }
    });
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/tradingview',
      payload: { token: 'secret', strategy: 's', signal_id: 'dup', action: 'close_all', symbol: 'BTCUSDT', order_type: 'market' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: false, signal_id: 'dup', reason: 'duplicate' });
  });

  it('rate limits admin endpoints', async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await app.inject({
        method: 'GET',
        url: '/logs',
        headers: { 'admin-token': 'admin' }
      });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: 'GET',
      url: '/logs',
      headers: { 'admin-token': 'admin' }
    });

    expect(limited.statusCode).toBe(429);
  });
});
