import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import {
  createCreatePayPalPaymentHandler,
  createPayPalPaymentInputSchema
} from '../src/mcp/tools/createPayPalPayment.js';
import type { PayPalClient } from '../src/paypal/paypalClient.js';
import type { PayPalOrder } from '../src/paypal/paypalTypes.js';

const silentLogger = pino({ level: 'silent' });

function fakePayPalClient(overrides: Partial<PayPalClient> = {}): PayPalClient {
  return {
    createOrder: vi.fn(),
    getOrder: vi.fn(),
    captureOrder: vi.fn(),
    ...overrides
  } as unknown as PayPalClient;
}

describe('createPayPalPaymentInputSchema', () => {
  it('rejects an amount without exactly two decimals', () => {
    const result = createPayPalPaymentInputSchema.safeParse({
      salesforceOrderId: 'SF-1',
      orderNumber: 'ON-1',
      amount: '49.9'
    });
    expect(result.success).toBe(false);
  });

  it('rejects an amount that is not greater than zero', () => {
    const result = createPayPalPaymentInputSchema.safeParse({
      salesforceOrderId: 'SF-1',
      orderNumber: 'ON-1',
      amount: '0.00'
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown additional properties', () => {
    const result = createPayPalPaymentInputSchema.safeParse({
      salesforceOrderId: 'SF-1',
      orderNumber: 'ON-1',
      amount: '10.00',
      unexpectedField: 'nope'
    });
    expect(result.success).toBe(false);
  });

  it('defaults currency to EUR and uppercases a provided currency', () => {
    const parsed = createPayPalPaymentInputSchema.parse({
      salesforceOrderId: 'SF-1',
      orderNumber: 'ON-1',
      amount: '10.00',
      currency: 'usd'
    });
    expect(parsed.currency).toBe('USD');

    const withDefault = createPayPalPaymentInputSchema.parse({
      salesforceOrderId: 'SF-1',
      orderNumber: 'ON-1',
      amount: '10.00'
    });
    expect(withDefault.currency).toBe('EUR');
  });
});

describe('createCreatePayPalPaymentHandler', () => {
  const baseInput = {
    salesforceOrderId: 'SF-1',
    orderNumber: 'ON-1',
    amount: '49.99',
    currency: 'EUR'
  };

  it('returns the approval link and paid=false when PayPal creates the order successfully', async () => {
    const order: PayPalOrder = {
      id: 'PAYPAL-ORDER-1',
      status: 'CREATED',
      links: [
        { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/PAYPAL-ORDER-1' },
        { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-1' }
      ]
    };
    const paypalClient = fakePayPalClient({ createOrder: vi.fn().mockResolvedValue(order) });
    const handler = createCreatePayPalPaymentHandler({ paypalClient, publicBaseUrl: 'https://demo.example.com', logger: silentLogger });

    const result = await handler(baseInput);

    expect(result.structuredContent).toMatchObject({
      success: true,
      paypalOrderId: 'PAYPAL-ORDER-1',
      approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-1',
      status: 'CREATED',
      paid: false
    });
  });

  it('prefers the payer-action link over approve when both are present', async () => {
    const order: PayPalOrder = {
      id: 'PAYPAL-ORDER-1',
      status: 'PAYER_ACTION_REQUIRED',
      links: [
        { rel: 'approve', href: 'https://www.sandbox.paypal.com/approve-legacy' },
        { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/payer-action-new' }
      ]
    };
    const paypalClient = fakePayPalClient({ createOrder: vi.fn().mockResolvedValue(order) });
    const handler = createCreatePayPalPaymentHandler({ paypalClient, publicBaseUrl: 'https://demo.example.com', logger: silentLogger });

    const result = await handler(baseInput);

    expect(result.structuredContent?.approvalUrl).toBe('https://www.sandbox.paypal.com/payer-action-new');
    expect(result.structuredContent?.status).toBe('PAYER_ACTION_REQUIRED');
  });

  it('returns a controlled error when PayPal does not include an approval link', async () => {
    const order: PayPalOrder = { id: 'PAYPAL-ORDER-1', status: 'CREATED', links: [{ rel: 'self', href: 'https://x' }] };
    const paypalClient = fakePayPalClient({ createOrder: vi.fn().mockResolvedValue(order) });
    const handler = createCreatePayPalPaymentHandler({ paypalClient, publicBaseUrl: 'https://demo.example.com', logger: silentLogger });

    const result = await handler(baseInput);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toContain('No se pudo crear el pago');
  });
});
