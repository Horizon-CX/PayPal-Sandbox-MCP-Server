import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createFinalizePayPalPaymentHandler, finalizePayPalPaymentInputSchema } from '../src/mcp/tools/finalizePayPalPayment.js';
import { PayPalApiError } from '../src/paypal/paypalErrors.js';
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

const baseInput = { salesforceOrderId: 'SF-1', paypalOrderId: 'PAYPAL-ORDER-1' };

describe('finalizePayPalPaymentInputSchema', () => {
  it('rejects unknown additional properties', () => {
    const result = finalizePayPalPaymentInputSchema.safeParse({ ...baseInput, extra: 'nope' });
    expect(result.success).toBe(false);
  });
});

describe('createFinalizePayPalPaymentHandler', () => {
  it('does not capture and reports PENDING_CUSTOMER_APPROVAL when the order still needs buyer approval', async () => {
    const order: PayPalOrder = { id: 'PAYPAL-ORDER-1', status: 'CREATED' };
    const captureOrder = vi.fn();
    const paypalClient = fakePayPalClient({ getOrder: vi.fn().mockResolvedValue(order), captureOrder });
    const handler = createFinalizePayPalPaymentHandler({ paypalClient, logger: silentLogger });

    const result = await handler(baseInput);

    expect(captureOrder).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ paid: false, paymentStatus: 'PENDING_CUSTOMER_APPROVAL', paypalStatus: 'CREATED' });
  });

  it('captures an APPROVED order and reports paid=true once PayPal returns COMPLETED', async () => {
    const approvedOrder: PayPalOrder = { id: 'PAYPAL-ORDER-1', status: 'APPROVED' };
    const capturedOrder: PayPalOrder = {
      id: 'PAYPAL-ORDER-1',
      status: 'COMPLETED',
      purchase_units: [
        {
          amount: { currency_code: 'EUR', value: '49.99' },
          payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED' }] }
        }
      ]
    };
    const captureOrder = vi.fn().mockResolvedValue(capturedOrder);
    const paypalClient = fakePayPalClient({ getOrder: vi.fn().mockResolvedValue(approvedOrder), captureOrder });
    const handler = createFinalizePayPalPaymentHandler({ paypalClient, logger: silentLogger });

    const result = await handler(baseInput);

    expect(captureOrder).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      paid: true,
      paymentStatus: 'PAID',
      captureId: 'CAPTURE-1',
      amount: '49.99',
      currency: 'EUR'
    });
  });

  it('does not attempt to capture an already-COMPLETED order and still reports paid=true', async () => {
    const completedOrder: PayPalOrder = {
      id: 'PAYPAL-ORDER-1',
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED' }] } }]
    };
    const captureOrder = vi.fn();
    const paypalClient = fakePayPalClient({ getOrder: vi.fn().mockResolvedValue(completedOrder), captureOrder });
    const handler = createFinalizePayPalPaymentHandler({ paypalClient, logger: silentLogger });

    const result = await handler(baseInput);

    expect(captureOrder).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ paid: true, paymentStatus: 'PAID', captureId: 'CAPTURE-1' });
  });

  it('reports paid=false with paymentStatus VOIDED for a voided order', async () => {
    const voidedOrder: PayPalOrder = { id: 'PAYPAL-ORDER-1', status: 'VOIDED' };
    const paypalClient = fakePayPalClient({ getOrder: vi.fn().mockResolvedValue(voidedOrder) });
    const handler = createFinalizePayPalPaymentHandler({ paypalClient, logger: silentLogger });

    const result = await handler(baseInput);

    expect(result.structuredContent).toMatchObject({ paid: false, paymentStatus: 'VOIDED', paypalStatus: 'VOIDED' });
  });

  it('returns a controlled error and never claims paid=true when PayPal returns an HTTP error', async () => {
    const paypalClient = fakePayPalClient({
      getOrder: vi.fn().mockRejectedValue(new PayPalApiError(500, { message: 'Internal error' }, 'boom'))
    });
    const handler = createFinalizePayPalPaymentHandler({ paypalClient, logger: silentLogger });

    const result = await handler(baseInput);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('re-checks order status instead of failing when capture reports the order was already captured, and captures only once', async () => {
    const approvedOrder: PayPalOrder = { id: 'PAYPAL-ORDER-1', status: 'APPROVED' };
    const alreadyCapturedError = new PayPalApiError(
      422,
      { name: 'UNPROCESSABLE_ENTITY', message: 'Order already captured', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] },
      'capture failed'
    );
    const completedOrderAfterRefetch: PayPalOrder = {
      id: 'PAYPAL-ORDER-1',
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED' }] } }]
    };
    const getOrder = vi.fn().mockResolvedValueOnce(approvedOrder).mockResolvedValueOnce(completedOrderAfterRefetch);
    const captureOrder = vi.fn().mockRejectedValue(alreadyCapturedError);
    const paypalClient = fakePayPalClient({ getOrder, captureOrder });
    const handler = createFinalizePayPalPaymentHandler({ paypalClient, logger: silentLogger });

    const result = await handler(baseInput);

    expect(captureOrder).toHaveBeenCalledTimes(1);
    expect(getOrder).toHaveBeenCalledTimes(2);
    expect(result.structuredContent).toMatchObject({ paid: true, paymentStatus: 'PAID', captureId: 'CAPTURE-1' });
  });
});
