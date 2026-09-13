import type { AppConfig } from '../src/config/env.js';
import type { BydfiClientLike, PlaceOrderInput } from '../src/bydfi/client.js';
import type { BalanceSnapshot, OpenOrder, PlacedOrder, PositionSnapshot } from '../src/execution/types.js';

export const createTestConfig = (): AppConfig => ({
  nodeEnv: 'test',
  port: 3000,
  webhookToken: 'secret',
  adminToken: 'admin',
  bydfiApiKey: 'key',
  bydfiApiSecret: 'secret2',
  bydfiBaseUrl: 'https://api.example.com',
  tradingEnabled: true,
  allowedSourceIps: [],
  symbolMap: { BTCUSD: 'BTC-USDT' },
  symbolSpecs: { 'BTC-USDT': { qtyStep: 0.001, priceTick: 0.1 } },
  symbolLeverageCaps: { 'BTC-USDT': 10 },
  maxPositionSize: { 'BTC-USDT': 1 },
  maxLeverage: 20,
  leverageExceedAction: 'reject',
  maxOpenPositions: 3,
  maxDailyLossUsdt: 500,
  requireStopLoss: true,
  requireTakeProfit: false,
  allowPyramiding: false,
  marginMode: 'isolated',
  beOffsetTicks: 0,
  managerIntervalMs: 1000,
  dedupeTtlMs: 86_400_000,
  dataDir: '/tmp/bydfibridge-tests',
  dedupeStoreFile: '/tmp/bydfibridge-tests/dedupe-store.json',
  tradeStoreFile: '/tmp/bydfibridge-tests/trade-store.json',
  logStoreLimit: 50,
  discordWebhookUrl: undefined
});

export class MockBydfiClient implements BydfiClientLike {
  leverageCalls: Array<{ symbol: string; leverage: number }> = [];
  marginCalls: Array<{ symbol: string; mode: 'isolated' | 'cross' }> = [];
  ordersPlaced: PlaceOrderInput[] = [];
  batchOrdersPlaced: PlaceOrderInput[][] = [];
  cancelledOrders: Array<{ symbol: string; orderId: string }> = [];
  cancelAllCalls: string[] = [];
  positions: PositionSnapshot[] = [];
  openOrders: OpenOrder[] = [];
  balance: BalanceSnapshot = { equity: 10_000, availableBalance: 2_000 };
  orderLookup = new Map<string, PlacedOrder>();
  sequence = 0;
  nextEntryFilledQty?: number;

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    this.leverageCalls.push({ symbol, leverage });
  }

  async setMarginMode(symbol: string, marginMode: 'isolated' | 'cross'): Promise<void> {
    this.marginCalls.push({ symbol, mode: marginMode });
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
    this.ordersPlaced.push(input);
    const order: PlacedOrder = {
      id: `order-${++this.sequence}`,
      symbol: input.symbol,
      side: input.side,
      type: input.orderType,
      price: input.price,
      triggerPrice: input.triggerPrice,
      qty: input.qty,
      filledQty: !input.reduceOnly && this.nextEntryFilledQty !== undefined ? this.nextEntryFilledQty : input.qty,
      avgFillPrice: input.price ?? 100,
      reduceOnly: input.reduceOnly
    };
    if (!input.reduceOnly) {
      this.nextEntryFilledQty = undefined;
    }
    this.orderLookup.set(order.id, order);
    if (input.closePosition) {
      this.positions = this.positions.filter((position) => !(position.symbol === input.symbol && position.side === (input.positionSide === 'LONG' ? 'long' : 'short')));
    }
    if (input.orderType !== 'MARKET') {
      this.openOrders.push({
        id: order.id,
        symbol: input.symbol,
        side: input.side,
        type: input.orderType,
        price: input.price,
        triggerPrice: input.triggerPrice,
        qty: input.qty,
        reduceOnly: input.reduceOnly
      });
    }
    return order;
  }

  async batchPlaceOrders(inputs: PlaceOrderInput[]): Promise<PlacedOrder[]> {
    this.batchOrdersPlaced.push(inputs);
    return Promise.all(inputs.map((input) => this.placeOrder(input)));
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    this.cancelledOrders.push({ symbol, orderId });
    this.openOrders = this.openOrders.filter((order) => order.id !== orderId);
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    this.cancelAllCalls.push(symbol);
    this.openOrders = this.openOrders.filter((order) => order.symbol !== symbol);
  }

  async modifyOrder(): Promise<void> {}

  async getPositions(): Promise<PositionSnapshot[]> {
    return this.positions;
  }

  async getOpenOrders(symbol?: string): Promise<OpenOrder[]> {
    return symbol ? this.openOrders.filter((order) => order.symbol === symbol) : this.openOrders;
  }

  async getBalance(): Promise<BalanceSnapshot> {
    return this.balance;
  }

  async getOrder(_symbol: string, orderId: string): Promise<PlacedOrder | undefined> {
    return this.orderLookup.get(orderId);
  }

  async getExchangeInfo(): Promise<Record<string, unknown>> {
    return {};
  }
}
