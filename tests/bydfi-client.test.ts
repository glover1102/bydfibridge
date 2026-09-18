import { afterEach, describe, expect, it, vi } from 'vitest';
import { BydfiClient } from '../src/bydfi/client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BydfiClient', () => {
  it('includes the request path and response body in request errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"bad key"}', {
      status: 401,
      headers: { 'content-type': 'application/json' }
    })));

    const client = new BydfiClient({
      bydfiApiKey: 'key',
      bydfiApiSecret: 'secret',
      bydfiBaseUrl: 'https://api.example.com',
      bydfiSignatureHeader: 'X-SIGNATURE'
    });

    const error = await client.getBalance().catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('/api/v2/fapi/account/balance');
    expect((error as Error).message).toContain('{"message":"bad key"}');
  });

  it('uses the configured signature header name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { equity: 1, availableBalance: 1 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new BydfiClient({
      bydfiApiKey: 'key',
      bydfiApiSecret: 'secret',
      bydfiBaseUrl: 'https://api.example.com',
      bydfiSignatureHeader: 'X-API-SIGNATURE'
    });

    await expect(client.getBalance()).resolves.toEqual({ equity: 1, availableBalance: 1 });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.headers).toMatchObject({
      'X-API-KEY': 'key',
      'X-API-TIMESTAMP': expect.any(String),
      'X-API-SIGNATURE': expect.any(String)
    });
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

    const client = new BydfiClient({
      bydfiApiKey: 'key',
      bydfiApiSecret: 'secret',
      bydfiBaseUrl: 'https://api.example.com',
      bydfiSignatureHeader: 'X-SIGNATURE'
    });

    const error = await client.getBalance().catch((caughtError) => caughtError);

    expect((error as Error).message).toContain('"message":"denied"');
    expect((error as Error).message).toContain('"token":"[REDACTED]"');
    expect((error as Error).message).toContain('"apiKey":"[REDACTED]"');
  });
});
