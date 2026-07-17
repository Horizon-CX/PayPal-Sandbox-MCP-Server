import { z } from 'zod';
import type { Logger } from 'pino';
import type { PayPalClient } from '../../paypal/paypalClient.js';
import { PayPalApiError, toSafeErrorMessage } from '../../paypal/paypalErrors.js';
import type { PayPalOrder } from '../../paypal/paypalTypes.js';

export const TOOL_NAME_FINALIZE_PAYMENT = 'finalize_paypal_payment';

const ORDER_ALREADY_CAPTURED_ISSUE = 'ORDER_ALREADY_CAPTURED';

export const finalizePayPalPaymentInputSchema = z
  .object({
    salesforceOrderId: z.string().trim().min(1, 'salesforceOrderId is required'),
    paypalOrderId: z.string().trim().min(1, 'paypalOrderId is required')
  })
  .strict();

export type FinalizePayPalPaymentInput = z.infer<typeof finalizePayPalPaymentInputSchema>;

const paymentStatusEnum = z.enum(['PAID', 'PENDING_CUSTOMER_APPROVAL', 'VOIDED', 'UNKNOWN']);

export const finalizePayPalPaymentOutputShape = {
  success: z.boolean(),
  salesforceOrderId: z.string(),
  paypalOrderId: z.string(),
  paypalStatus: z.string(),
  paymentStatus: paymentStatusEnum,
  paid: z.boolean(),
  captureId: z.string().optional(),
  amount: z.string().optional(),
  currency: z.string().optional()
};

interface FinalizedState {
  paypalStatus: string;
  paymentStatus: z.infer<typeof paymentStatusEnum>;
  paid: boolean;
  captureId: string | undefined;
}

function extractAmount(order: PayPalOrder): { amount: string | undefined; currency: string | undefined } {
  const amount = order.purchase_units?.[0]?.amount;
  return { amount: amount?.value, currency: amount?.currency_code };
}

function extractCaptureId(order: PayPalOrder): string | undefined {
  return order.purchase_units?.[0]?.payments?.captures?.[0]?.id;
}

function resolveFromOrderStatus(order: PayPalOrder): FinalizedState {
  switch (order.status) {
    case 'CREATED':
    case 'PAYER_ACTION_REQUIRED':
      return { paypalStatus: order.status, paymentStatus: 'PENDING_CUSTOMER_APPROVAL', paid: false, captureId: undefined };
    case 'COMPLETED':
      return { paypalStatus: order.status, paymentStatus: 'PAID', paid: true, captureId: extractCaptureId(order) };
    case 'VOIDED':
      return { paypalStatus: order.status, paymentStatus: 'VOIDED', paid: false, captureId: undefined };
    default:
      return { paypalStatus: order.status, paymentStatus: 'UNKNOWN', paid: false, captureId: extractCaptureId(order) };
  }
}

export interface FinalizePayPalPaymentDeps {
  paypalClient: PayPalClient;
  logger: Logger;
}

export function createFinalizePayPalPaymentHandler(deps: FinalizePayPalPaymentDeps) {
  return async (input: FinalizePayPalPaymentInput) => {
    try {
      const order = await deps.paypalClient.getOrder(input.paypalOrderId);

      let finalOrder = order;
      if (order.status === 'APPROVED') {
        finalOrder = await captureApprovedOrder(deps, input.paypalOrderId);
      }

      const state = resolveFromOrderStatus(finalOrder);
      const { amount, currency } = extractAmount(finalOrder);

      const structuredContent = {
        success: true,
        salesforceOrderId: input.salesforceOrderId,
        paypalOrderId: input.paypalOrderId,
        paypalStatus: state.paypalStatus,
        paymentStatus: state.paymentStatus,
        paid: state.paid,
        captureId: state.captureId,
        amount,
        currency
      };

      return {
        structuredContent,
        content: [
          {
            type: 'text' as const,
            text: state.paid
              ? `Pago confirmado por PayPal para la orden ${input.paypalOrderId} (captureId: ${state.captureId ?? 'desconocido'}).`
              : `PayPal todavia no confirma el pago de la orden ${input.paypalOrderId}. Estado actual: ${state.paypalStatus}.`
          }
        ]
      };
    } catch (error) {
      const safeMessage = toSafeErrorMessage(error);
      deps.logger.error(
        { salesforceOrderId: input.salesforceOrderId, paypalOrderId: input.paypalOrderId, reason: safeMessage },
        'finalize_paypal_payment failed'
      );
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `No se pudo verificar el pago en PayPal para la orden ${input.paypalOrderId}: ${safeMessage}`
          }
        ]
      };
    }
  };
}

/**
 * Captures an APPROVED order. If PayPal reports the order was already captured by a prior
 * (e.g. retried) call, re-fetches the order instead of treating the 422 as a failure -
 * PayPal's live status is always the source of truth, never the captured/thrown error.
 */
async function captureApprovedOrder(deps: FinalizePayPalPaymentDeps, paypalOrderId: string): Promise<PayPalOrder> {
  try {
    return await deps.paypalClient.captureOrder(paypalOrderId);
  } catch (error) {
    if (error instanceof PayPalApiError && error.hasIssue(ORDER_ALREADY_CAPTURED_ISSUE)) {
      deps.logger.warn({ paypalOrderId }, 'Capture reported as already completed by PayPal; re-fetching order status');
      return deps.paypalClient.getOrder(paypalOrderId);
    }
    throw error;
  }
}
