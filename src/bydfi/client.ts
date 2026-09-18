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
const encoder = new TextEncoder();

type HttpMethod = 'GET' | 'POST';

interface RequestOptions {
  method?: HttpMethod;
  params?: Record<string, unknown>;
  signed?: boolean;
}

export class BydfiApiError extends Error {
  constructor(
    message: string,
    readonly details: {
      path: string;
      method: HttpMethod;
      status?: number;
      responseBody?: string;
    }
  ) {
    super(message);
    this.name = 'BydfiApiError';
  }
}

export const serializeParams = (params: Record<string, unknown>): string => Object.entries(params)
  .filter(([, value]) => value !== undefined)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
  .join('&');

export const buildSignaturePayload = (accessKey: string, timestamp: string, query: string, body: string): string =>
  `${accessKey}${timestamp}${query}${body}`;

const signHmacSha256 = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export class BydfiClient implements BydfiClientLike {
  constructor(private readonly config: Pick<AppConfig, 'bydfiApiKey' | 'bydfiApiSecret' | 'bydfiBaseUrl' | 'bydfiWallet'>) {}

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.request('/v1/fapi/trade/leverage', {
      params: { wallet: this.config.bydfiWallet, symbol, leverage }
    });
  }

  async setMarginMode(symbol: string, marginMode: 'isolated' | 'cross'): Promise<void> {
    await this.request('/v1/fapi/user_data/margin_type', {
      params: {
        contractType: 'FUTURE',
        wallet: this.config.bydfiWallet,
        symbol,
        marginType: marginMode.toUpperCase()
      }
    });
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
    const data = await this.request<Record<string, unknown>>('/api/v2/fapi/trade/place_order', {
      params: {
        wallet: this.config.bydfiWallet,
        symbol: input.symbol,
        side: input.side.toUpperCase(),
        type: input.orderType,
        quantity: input.qty,
        price: input.price,
        triggerPrice: input.triggerPrice,
        reduceOnly: input.reduceOnly,
        closePosition: input.closePosition,
        positionSide: input.positionSide
      }
    });
    return {
      id: String(data.orderId ?? data.id ?? crypto.randomUUID()),
      symbol: input.symbol,
      side: input.side,
      type: input.orderType,
      price: input.price,
      triggerPrice: input.triggerPrice,
      qty: input.qty,
      filledQty: Number(data.executedQty ?? data.dealQuantity ?? input.qty),
      avgFillPrice: Number(data.avgPrice ?? input.price ?? 0),
      reduceOnly: input.reduceOnly
    };
  }

  async batchPlaceOrders(inputs: PlaceOrderInput[]): Promise<PlacedOrder[]> {
    const data = await this.request<Array<Record<string, unknown>>>('/api/v2/fapi/trade/batch_place_order', {
      params: {
        wallet: this.config.bydfiWallet,
        orders: inputs.map((input) => ({
          symbol: input.symbol,
          side: input.side.toUpperCase(),
          type: input.orderType,
          quantity: input.qty,
          price: input.price,
          triggerPrice: input.triggerPrice,
          reduceOnly: input.reduceOnly,
          closePosition: input.closePosition,
          positionSide: input.positionSide
        }))
      }
    });
    return inputs.map((input, index) => ({
      id: String(data[index]?.orderId ?? data[index]?.id ?? crypto.randomUUID()),
      symbol: input.symbol,
      side: input.side,
      type: input.orderType,
      price: input.price,
      triggerPrice: input.triggerPrice,
      qty: input.qty,
      filledQty: Number(data[index]?.executedQty ?? data[index]?.dealQuantity ?? input.qty),
      avgFillPrice: Number(data[index]?.avgPrice ?? input.price ?? 0),
      reduceOnly: input.reduceOnly
    }));
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request('/api/v2/fapi/trade/cancel_order', { params: { wallet: this.config.bydfiWallet, symbol, orderId } });
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    await this.request('/api/v2/fapi/trade/cancel_all', { params: { wallet: this.config.bydfiWallet, symbol } });
  }

  async modifyOrder(symbol: string, orderId: string, changes: Partial<PlaceOrderInput>): Promise<void> {
    await this.request('/api/v2/fapi/trade/modify_order', {
      params: {
        wallet: this.config.bydfiWallet,
        symbol,
        orderId,
        ...changes
      }
    });
  }

  async getPositions(): Promise<PositionSnapshot[]> {
    const data = await this.request<Array<Record<string, unknown>>>('/v1/fapi/trade/positions', {
      method: 'GET',
      params: { wallet: this.config.bydfiWallet }
    });
    return data.map((position) => ({
      symbol: String(position.symbol),
      side: toTradeSide(position.positionSide),
      qty: Number(position.quantity ?? position.qty ?? position.positionQty ?? 0),
      entryPrice: Number(position.entryPrice ?? position.avgPrice ?? 0),
      realizedPnl: Number(position.realizedPnl ?? 0),
      unrealizedPnl: Number(position.unrealizedPnl ?? 0)
    })).filter((position) => position.qty > 0);
  }

  async getOpenOrders(symbol?: string): Promise<OpenOrder[]> {
    const data = await this.request<Array<Record<string, unknown>>>('/v1/fapi/trade/open_order', {
      method: 'GET',
      params: { wallet: this.config.bydfiWallet, symbol }
    });
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
    const data = await this.request<Record<string, unknown>>('/v1/fapi/account/balance', {
      method: 'GET',
      params: { wallet: this.config.bydfiWallet }
    });
    return {
      equity: Number(data.equity ?? data.balance ?? data.totalEquity ?? 0),
      availableBalance: Number(data.availableBalance ?? data.available ?? data.availableMargin ?? data.balance ?? 0)
    };
  }

  async getOrder(symbol: string, orderId: string): Promise<PlacedOrder | undefined> {
    const data = await this.request<Record<string, unknown>>('/v1/fapi/trade/open_order', {
      method: 'GET',
      params: { wallet: this.config.bydfiWallet, symbol, orderId }
    });
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
      filledQty: Number(data.executedQty ?? data.dealQuantity ?? data.qty ?? 0),
      avgFillPrice: Number(data.avgPrice ?? 0),
      reduceOnly: Boolean(data.reduceOnly)
    };
  }

  async getExchangeInfo(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/v1/fapi/market/exchange_info', {
      method: 'GET',
      signed: false
    });
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

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'POST';
    const params = options.params ?? {};
    const timestamp = Date.now().toString();
    const query = serializeParams(params);
    const body = method === 'GET' ? '' : JSON.stringify(params);
    const requestUrl = `${this.config.bydfiBaseUrl}${path}${query ? `?${query}` : ''}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    if (options.signed !== false) {
      // BYDFi docs specify X-API-KEY, X-API-TIMESTAMP, and X-API-SIGNATURE headers.
      // The signature payload is accessKey + timestamp + queryString + body, where GET
      // requests sign an empty body and POST requests sign the JSON body.
      const signature = await signHmacSha256(
        this.config.bydfiApiSecret,
        buildSignaturePayload(this.config.bydfiApiKey, timestamp, query, body)
      );
      headers['X-API-KEY'] = this.config.bydfiApiKey;
      headers['X-API-TIMESTAMP'] = timestamp;
      headers['X-API-SIGNATURE'] = signature;
    }

    const response = await fetch(requestUrl, {
      method,
      headers,
      body: method === 'GET' ? undefined : body
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new BydfiApiError(
        `BYDFi request failed for ${method} ${path} with status ${response.status}: ${responseText || '<empty body>'}`,
        { path, method, status: response.status, responseBody: responseText }
      );
    }

    const payload = responseText ? JSON.parse(responseText) as ApiEnvelope<T> | T : undefined;
    if (!payload || typeof payload !== 'object') {
      return payload as T;
    }
    if (!('code' in payload) && !('data' in payload)) {
      return payload as T;
    }
    if ((payload.code !== undefined && String(payload.code) !== '0' && String(payload.code).toLowerCase() !== 'success')) {
      throw new BydfiApiError(
        `${payload.message ?? payload.msg ?? 'Unknown BYDFi API error'}: ${responseText}`,
        { path, method, status: response.status, responseBody: responseText }
      );
    }
    return (payload.data ?? payload) as T;
  }
}

export { toPositionSide };
