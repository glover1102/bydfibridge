import { afterEach, describe, expect, it, vi } from 'vitest';
import { BydfiApiError, BydfiClient, buildSignaturePayload, serializeParams } from '../src/bydfi/client.js';
import { createTestConfig } from './helpers.js';

describe('BydfiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('signs GET requests with query params and the configured signature header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { balance: '123', availableBalance: '45' }
    })));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const client = new BydfiClient({ ...createTestConfig(), bydfiSignatureHeader: 'X-API-SIGNATURE' });
    await client.getBalance();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/fapi/account/balance?wallet=W001');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({
      'X-API-KEY': 'key',
      'X-API-TIMESTAMP': '1700000000000',
      'X-API-SIGNATURE': expect.any(String)
    });
    expect((init.headers as Record<string, string>)['X-SIGNATURE']).toBeUndefined();
  });

  it('exports the documented signature payload format', () => {
    expect(serializeParams({ wallet: 'W001', symbol: 'BTC-USDT' })).toBe('symbol=BTC-USDT&wallet=W001');
    expect(buildSignaturePayload('key', '123', 'symbol=BTC-USDT', '{"foo":"bar"}'))
      .toBe('key123symbol=BTC-USDT{"foo":"bar"}');
  });

  it('sends POST params in a sorted JSON body instead of the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: {} })));
    vi.stubGlobal('fetch', fetchMock);

    const client = new BydfiClient(createTestConfig());
    await client.setLeverage('BTC-USDT', 10);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/fapi/trade/leverage');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"leverage":10,"symbol":"BTC-USDT","wallet":"W001"}');
  });

  it('does not assume fills when placement responses omit fill fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: { orderId: '123' }
    }))));

    const client = new BydfiClient(createTestConfig());
    await expect(client.placeOrder({
      symbol: 'BTC-USDT',
      side: 'buy',
      orderType: 'MARKET',
      qty: 0.01,
      positionSide: 'LONG'
    })).resolves.toMatchObject({
      id: '123',
      filledQty: 0
    });
  });

  it('does not sign public exchange-info requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ symbols: [] })));
    vi.stubGlobal('fetch', fetchMock);

    const client = new BydfiClient(createTestConfig());
    await client.getExchangeInfo();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/fapi/market/exchange_info');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('maps SELL positions to short and normalizes negative qty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: [{ symbol: 'BTC-USDT', side: 'SELL', quantity: '-0.5', entryPrice: '25000' }]
    }))));

    const client = new BydfiClient(createTestConfig());

    await expect(client.getPositions()).resolves.toEqual([{
      symbol: 'BTC-USDT',
      side: 'short',
      qty: 0.5,
      entryPrice: 25000,
      realizedPnl: 0,
      unrealizedPnl: 0
    }]);
  });

  it('includes the request path and response body in request errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"bad key"}', {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })));

    const client = new BydfiClient(createTestConfig());
    const error = await client.getBalance().catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(BydfiApiError);
    expect((error as Error).message).toContain('/v1/fapi/account/balance');
    expect((error as Error).message).toContain('{"message":"bad key"}');
  });

  it('redacts obvious secret fields from request error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: 'denied',
      token: 'abc123',
      apiKey: 'key-123'
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })));

    const client = new BydfiClient(createTestConfig());
    const error = await client.getBalance().catch((caughtError) => caughtError);

    expect((error as Error).message).toContain('"message":"denied"');
    expect((error as Error).message).toContain('"token":"[REDACTED]"');
    expect((error as Error).message).toContain('"apiKey":"[REDACTED]"');
  });

  it('redacts quoted secret fields from non-json error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error: "token":"abc123" "signature":"sig456"', {
      status: 401,
      headers: { 'content-type': 'text/plain' }
    })));

    const client = new BydfiClient(createTestConfig());
    const error = await client.getBalance().catch((caughtError) => caughtError);

    expect((error as Error).message).toContain('"token":"[REDACTED]"');
    expect((error as Error).message).toContain('"signature":"[REDACTED]"');
  });

  it('surfaces status and sanitized body details on request failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad signature', {
      status: 401,
      statusText: 'Unauthorized'
    })));

    const client = new BydfiClient(createTestConfig());

    await expect(client.getPositions()).rejects.toMatchObject({
      name: 'BydfiApiError',
      details: expect.objectContaining({
        path: '/v1/fapi/trade/positions',
        method: 'GET',
        status: 401,
        responseBody: 'bad signature'
      })
    } satisfies Partial<BydfiApiError>);
  });

  it('wraps non-json success bodies in a BydfiApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));

    const client = new BydfiClient(createTestConfig());

    await expect(client.getBalance()).rejects.toMatchObject({
      name: 'BydfiApiError',
      details: expect.objectContaining({
        path: '/v1/fapi/account/balance',
        method: 'GET',
        status: 200,
        responseBody: 'ok'
      })
    } satisfies Partial<BydfiApiError>);
  });

  it('falls back to history_order when an order is no longer open', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: [{ orderId: '123', symbol: 'BTC-USDT', side: 'BUY', quantity: '0.01', dealQuantity: '0.01', avgPrice: '25000' }]
      })));
    vi.stubGlobal('fetch', fetchMock);

    const client = new BydfiClient(createTestConfig());
    await expect(client.getOrder('BTC-USDT', '123')).resolves.toMatchObject({
      id: '123',
      symbol: 'BTC-USDT',
      side: 'buy',
      qty: 0.01,
      filledQty: 0.01,
      avgFillPrice: 25000
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.com/v1/fapi/trade/history_order?orderId=123&symbol=BTC-USDT&wallet=W001');
  });

  it('accepts a single history-order record even if the id field is omitted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { symbol: 'BTC-USDT', side: 'BUY', quantity: '0.01', dealQuantity: '0.01', avgPrice: '25000' }
      })));
    vi.stubGlobal('fetch', fetchMock);

    const client = new BydfiClient(createTestConfig());
    await expect(client.getOrder('BTC-USDT', '123')).resolves.toMatchObject({
      id: '123',
      symbol: 'BTC-USDT',
      side: 'buy'
    });
  });
});
