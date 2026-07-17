import { z } from 'zod';
import type { Logger } from 'pino';
import type { PayPalClient } from '../../paypal/paypalClient.js';
import { PayPalMissingApprovalLinkError, toSafeErrorMessage } from '../../paypal/paypalErrors.js';
import type { PayPalOrder } from '../../paypal/paypalTypes.js';

export const TOOL_NAME_CREATE_PAYMENT = 'create_paypal_payment';

export const createPayPalPaymentInputSchema = z
  .object({
    salesforceOrderId: z.string().trim().min(1, 'salesforceOrderId is required'),
    orderNumber: z.string().trim().min(1, 'orderNumber is required'),
    amount: z
      .string()
      .regex(/^\d+\.\d{2}$/, 'amount must use a decimal point and exactly two decimals, e.g. 49.99')
      .refine((value) => Number.parseFloat(value) > 0, 'amount must be greater than zero'),
    currency: z
      .string()
      .trim()
      .length(3, 'currency must be a 3-letter ISO 4217 code')
      .default('EUR')
      .transform((value) => value.toUpperCase()),
    description: z.string().max(500, 'description is too long').optional()
  })
  .strict();

export type CreatePayPalPaymentInput = z.infer<typeof createPayPalPaymentInputSchema>;

export const createPayPalPaymentOutputShape = {
  success: z.boolean(),
  salesforceOrderId: z.string(),
  orderNumber: z.string(),
  paypalOrderId: z.string(),
  approvalUrl: z.string(),
  status: z.enum(['CREATED', 'PAYER_ACTION_REQUIRED']),
  paid: z.literal(false),
  amount: z.string(),
  currency: z.string()
};

function findApprovalLink(order: PayPalOrder): string | undefined {
  const links = order.links ?? [];
  const payerAction = links.find((link) => link.rel === 'payer-action');
  const approve = links.find((link) => link.rel === 'approve');
  return payerAction?.href ?? approve?.href;
}

export interface CreatePayPalPaymentDeps {
  paypalClient: PayPalClient;
  publicBaseUrl: string;
  logger: Logger;
}

export function createCreatePayPalPaymentHandler(deps: CreatePayPalPaymentDeps) {
  return async (input: CreatePayPalPaymentInput) => {
    try {
      const order = await deps.paypalClient.createOrder({
        salesforceOrderId: input.salesforceOrderId,
        orderNumber: input.orderNumber,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        returnUrl: `${deps.publicBaseUrl}/paypal/return`,
        cancelUrl: `${deps.publicBaseUrl}/paypal/cancel`
      });

      const approvalUrl = findApprovalLink(order);
      if (!approvalUrl) {
        throw new PayPalMissingApprovalLinkError(order.id);
      }

      const status = order.status === 'PAYER_ACTION_REQUIRED' ? ('PAYER_ACTION_REQUIRED' as const) : ('CREATED' as const);

      const structuredContent = {
        success: true,
        salesforceOrderId: input.salesforceOrderId,
        orderNumber: input.orderNumber,
        paypalOrderId: order.id,
        approvalUrl,
        status,
        paid: false as const,
        amount: input.amount,
        currency: input.currency
      };

      return {
        structuredContent,
        content: [
          {
            type: 'text' as const,
            text: `Orden PayPal creada (${order.id}). Envia este enlace al comprador para aprobar el pago: ${approvalUrl}`
          }
        ]
      };
    } catch (error) {
      const safeMessage = toSafeErrorMessage(error);
      deps.logger.error(
        { salesforceOrderId: input.salesforceOrderId, orderNumber: input.orderNumber, reason: safeMessage },
        'create_paypal_payment failed'
      );
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `No se pudo crear el pago en PayPal para la orden ${input.orderNumber}: ${safeMessage}`
          }
        ]
      };
    }
  };
}
