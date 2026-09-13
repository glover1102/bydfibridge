import { createHmac } from 'node:crypto';
import type { AppConfig } from '../config/env.js';
import type { OpenOrder, PlacedOrder, PositionSnapshot, BalanceSnapshot, TradeSide } from '../execution/types.js';

export interface PlaceOrderInput {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  qty: number;
  price?: number;
  triggerPrice?: number;
  reduceOnly?: boolean;
  closePosition?: boolean;
  positionSide: 'LONG' | 'SHORT';
}

interface ApiEnvelope<T> {
  code?: number | string;
  message?: string;
  msg?: string;
  data?: T;
}

export interface BydfiClientLike {
  setLeverage(symbol: string, leverage: number): Promise<void>;
  setMarginMode(symbol: string, marginMode: 'isolated' | 'cross'): Promise<void>;
  placeOrder(input: PlaceOrderInput): Promise<PlacedOrder>;
  batchPlaceOrders(inputs: PlaceOrderInput[]): Promise<PlacedOrder[]>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
  cancelAllOrders(symbol: string): Promise<void>;
  modifyOrder(symbol: string, orderId: string, changes: Partial<PlaceOrderInput>): Promise<void>;
  getPositions(): Promise<PositionSnapshot[]>;
  getOpenOrders(symbol?: string): Promise<OpenOrder[]>;
  getBalance(): Promise<BalanceSnapshot>;
  getOrder(symbol: string, orderId: string): Promise<PlacedOrder | undefined>;
  getExchangeInfo(): Promise<Record<string, unknown>>;
}

const toPositionSide = (side: TradeSide): 'LONG' | 'SHORT' => side === 'long' ? 'LONG' : 'SHORT';
const toTradeSide = (side: unknown): TradeSide => String(side).toUpperCase() === 'SHORT' ? 'short' : 'long';

export class BydfiClient implements BydfiClientLike {
  constructor(private readonly config: Pick<AppConfig, 'bydfiApiKey' | 'bydfiApiSecret' | 'bydfiBaseUrl'>) {}

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.request('/v2/fapi/position/set_leverage', { symbol, leverage });
  }

  async setMarginMode(symbol: string, marginMode: 'isolated' | 'cross'): Promise<void> {
    await this.request('/v2/fapi/position/set_margin_mode', { symbol, marginMode });
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
    const data = await this.request<Record<string, unknown>>('/v2/fapi/trade/place_order', {
      symbol: input.symbol,
      side: input.side,
      type: input.orderType,
      quantity: input.qty,
      price: input.price,
      triggerPrice: input.triggerPrice,
      reduceOnly: input.reduceOnly,
      closePosition: input.closePosition,
      positionSide: input.positionSide
    });
    return {
      id: String(data.orderId ?? data.id ?? crypto.randomUUID()),
      symbol: input.symbol,
      side: input.side,
      type: input.orderType,
      price: input.price,
      triggerPrice: input.triggerPrice,
      qty: input.qty,
      filledQty: Number(data.executedQty ?? input.qty),
      avgFillPrice: Number(data.avgPrice ?? input.price ?? 0),
      reduceOnly: input.reduceOnly
    };
  }

  async batchPlaceOrders(inputs: PlaceOrderInput[]): Promise<PlacedOrder[]> {
    const data = await this.request<Array<Record<string, unknown>>>('/v2/fapi/trade/batch_place_order', {
      orders: inputs
    });
    return inputs.map((input, index) => ({
      id: String(data[index]?.orderId ?? data[index]?.id ?? crypto.randomUUID()),
      symbol: input.symbol,
      side: input.side,
      type: input.orderType,
      price: input.price,
      triggerPrice: input.triggerPrice,
      qty: input.qty,
      filledQty: Number(data[index]?.executedQty ?? input.qty),
      avgFillPrice: Number(data[index]?.avgPrice ?? input.price ?? 0),
      reduceOnly: input.reduceOnly
    }));
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request('/v2/fapi/trade/cancel_order', { symbol, orderId });
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    await this.request('/v2/fapi/trade/cancel_all', { symbol });
  }

  async modifyOrder(symbol: string, orderId: string, changes: Partial<PlaceOrderInput>): Promise<void> {
    await this.request('/v2/fapi/trade/modify_order', { symbol, orderId, ...changes });
  }

  async getPositions(): Promise<PositionSnapshot[]> {
    const data = await this.request<Array<Record<string, unknown>>>('/v2/fapi/position/list', {});
    return data.map((position) => ({
      symbol: String(position.symbol),
      side: toTradeSide(position.positionSide),
      qty: Number(position.quantity ?? position.qty ?? 0),
      entryPrice: Number(position.entryPrice ?? position.avgPrice ?? 0),
      realizedPnl: Number(position.realizedPnl ?? 0),
      unrealizedPnl: Number(position.unrealizedPnl ?? 0)
    })).filter((position) => position.qty > 0);
  }

  async getOpenOrders(symbol?: string): Promise<OpenOrder[]> {
    const data = await this.request<Array<Record<string, unknown>>>('/v2/fapi/trade/open_orders', symbol ? { symbol } : {});
    return data.map((order) => ({
      id: String(order.orderId ?? order.id),
      symbol: String(order.symbol),
      side: String(order.side).toLowerCase() === 'buy' ? 'buy' : 'sell',
      type: String(order.type ?? order.orderType),
      triggerPrice: order.triggerPrice ? Number(order.triggerPrice) : undefined,
      price: order.price ? Number(order.price) : undefined,
      qty: Number(order.quantity ?? order.qty ?? 0),
      status: order.status ? String(order.status) : undefined,
      reduceOnly: Boolean(order.reduceOnly)
    }));
  }

  async getBalance(): Promise<BalanceSnapshot> {
    const data = await this.request<Record<string, unknown>>('/v2/fapi/account/balance', {});
    return {
      equity: Number(data.equity ?? data.balance ?? 0),
      availableBalance: Number(data.availableBalance ?? data.available ?? data.balance ?? 0)
    };
  }

  async getOrder(symbol: string, orderId: string): Promise<PlacedOrder | undefined> {
    const data = await this.request<Record<string, unknown>>('/v2/fapi/trade/order', { symbol, orderId });
    if (!data || Object.keys(data).length === 0) {
      return undefined;
    }
    return {
      id: String(data.orderId ?? data.id ?? orderId),
      symbol,
      side: String(data.side).toLowerCase() === 'buy' ? 'buy' : 'sell',
      type: String(data.type ?? 'MARKET'),
      price: data.price ? Number(data.price) : undefined,
      triggerPrice: data.triggerPrice ? Number(data.triggerPrice) : undefined,
      qty: Number(data.quantity ?? data.qty ?? 0),
      filledQty: Number(data.executedQty ?? data.qty ?? 0),
      avgFillPrice: Number(data.avgPrice ?? 0),
      reduceOnly: Boolean(data.reduceOnly)
    };
  }

  async getExchangeInfo(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/v2/fapi/public/exchange_info', {});
  }

  async closePositionMarket(symbol: string, side: TradeSide, qty: number): Promise<PlacedOrder> {
    return this.placeOrder({
      symbol,
      side: side === 'long' ? 'sell' : 'buy',
      orderType: 'MARKET',
      qty,
      reduceOnly: true,
      closePosition: true,
      positionSide: toPositionSide(side)
    });
  }

  private async request<T>(path: string, params: Record<string, unknown>): Promise<T> {
    const timestamp = Date.now().toString();
    const query = this.serialize(params);
    // BYDFi's live documentation should be verified for the exact signature payload and header names.
    // This implementation signs apiKey + timestamp + serializedParams and sends common X-* headers.
    const signature = createHmac('sha256', this.config.bydfiApiSecret)
      .update(`${this.config.bydfiApiKey}${timestamp}${query}`)
      .digest('hex');

    const response = await fetch(`${this.config.bydfiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-API-KEY': this.config.bydfiApiKey,
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': signature
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`BYDFi request failed with status ${response.status}`);
    }

    const payload = await response.json() as ApiEnvelope<T>;
    if ((payload.code !== undefined && String(payload.code) !== '0' && String(payload.code).toLowerCase() !== 'success')) {
      throw new Error(payload.message ?? payload.msg ?? 'Unknown BYDFi API error');
    }
    return payload.data as T;
  }

  private serialize(params: Record<string, unknown>): string {
    return Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join('&');
  }
}

export { toPositionSide };
