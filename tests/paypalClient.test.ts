import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayPalClient } from '../src/paypal/paypalClient.js';
import { PayPalApiError, PayPalTimeoutError } from '../src/paypal/paypalErrors.js';

const API_BASE_URL = 'https://api-m.sandbox.paypal.com';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function tokenResponseBody() {
  return { access_token: 'fake-access-token', token_type: 'Bearer', expires_in: 32400 };
}

function orderResponseBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'PAYPAL-ORDER-1',
    status: 'CREATED',
    links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-1', method: 'GET' }],
    ...overrides
  };
}

describe('PayPalClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function newClient(timeoutMs?: number): PayPalClient {
    return new PayPalClient({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      apiBaseUrl: API_BASE_URL,
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
    });
  }

  it('obtains an access token and caches it across multiple calls', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, tokenResponseBody()))
      .mockResolvedValueOnce(jsonResponse(201, orderResponseBody()))
      .mockResolvedValueOnce(jsonResponse(201, orderResponseBody({ id: 'PAYPAL-ORDER-2' })));

    const client = newClient();
    await client.createOrder({
      salesforceOrderId: 'SF-1',
      orderNumber: 'ON-1',
      amount: '10.00',
      currency: 'EUR',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel'
    });
    await client.createOrder({
      salesforceOrderId: 'SF-2',
      orderNumber: 'ON-2',
      amount: '20.00',
      currency: 'EUR',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel'
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('creates an order with the expected payload and a deterministic PayPal-Request-Id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, tokenResponseBody())).mockResolvedValueOnce(jsonResponse(201, orderResponseBody()));

    const client = newClient();
    const order = await client.createOrder({
      salesforceOrderId: 'SF-1',
      orderNumber: 'ON-1',
      amount: '49.99',
      currency: 'EUR',
      description: 'Pedido demo',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel'
    });

    expect(order.id).toBe('PAYPAL-ORDER-1');
    const [, createOrderCallInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const sentBody = JSON.parse(createOrderCallInit.body as string) as Record<string, unknown>;
    expect(sentBody).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: 'SF-1',
          custom_id: 'ON-1',
          description: 'Pedido demo',
          amount: { currency_code: 'EUR', value: '49.99' }
        }
      ]
    });
    const headers = createOrderCallInit.headers as Record<string, string>;
    expect(headers['PayPal-Request-Id']).toMatch(/^create-[a-f0-9]{64}$/);
  });

  it('maps a non-2xx PayPal response to a PayPalApiError with the original status and debug id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { name: 'INVALID_CLIENT', message: 'Client Authentication failed', debug_id: 'abc123' })
    );

    const client = newClient();
    const call = client.createOrder({
      salesforceOrderId: 'SF-1',
      orderNumber: 'ON-1',
      amount: '10.00',
      currency: 'EUR',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel'
    });

    await expect(call).rejects.toBeInstanceOf(PayPalApiError);
    try {
      await call;
      expect.unreachable('createOrder should have rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(PayPalApiError);
      const apiError = error as PayPalApiError;
      expect(apiError.httpStatus).toBe(401);
      expect(apiError.paypalDebugId).toBe('abc123');
    }
  });

  it('throws a PayPalTimeoutError when the request exceeds the configured timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        })
    );

    const client = newClient(5);
    await expect(
      client.createOrder({
        salesforceOrderId: 'SF-1',
        orderNumber: 'ON-1',
        amount: '10.00',
        currency: 'EUR',
        returnUrl: 'https://example.com/return',
        cancelUrl: 'https://example.com/cancel'
      })
    ).rejects.toBeInstanceOf(PayPalTimeoutError);
  });
});
