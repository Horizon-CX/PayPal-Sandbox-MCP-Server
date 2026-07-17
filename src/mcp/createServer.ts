import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import type { PayPalClient } from '../paypal/paypalClient.js';
import {
  TOOL_NAME_CREATE_PAYMENT,
  createCreatePayPalPaymentHandler,
  createPayPalPaymentInputSchema,
  createPayPalPaymentOutputShape
} from './tools/createPayPalPayment.js';
import {
  TOOL_NAME_FINALIZE_PAYMENT,
  createFinalizePayPalPaymentHandler,
  finalizePayPalPaymentInputSchema,
  finalizePayPalPaymentOutputShape
} from './tools/finalizePayPalPayment.js';

export interface CreateMcpServerDeps {
  paypalClient: PayPalClient;
  publicBaseUrl: string;
  logger: Logger;
}

export function createMcpServer(deps: CreateMcpServerDeps): McpServer {
  const server = new McpServer({
    name: 'paypal-sandbox-payments',
    version: '1.0.0'
  });

  server.registerTool(
    TOOL_NAME_CREATE_PAYMENT,
    {
      title: 'Crear pago PayPal (Sandbox)',
      description:
        'Crea una orden de pago en PayPal Sandbox para una Order de Salesforce y devuelve el enlace que debe abrir el comprador. No confirma ni captura el pago.',
      inputSchema: createPayPalPaymentInputSchema,
      outputSchema: createPayPalPaymentOutputShape,
      annotations: {
        title: 'Crear pago PayPal (Sandbox)',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    createCreatePayPalPaymentHandler({ paypalClient: deps.paypalClient, publicBaseUrl: deps.publicBaseUrl, logger: deps.logger })
  );

  server.registerTool(
    TOOL_NAME_FINALIZE_PAYMENT,
    {
      title: 'Confirmar pago PayPal (Sandbox)',
      description:
        'Verifica en PayPal Sandbox si el comprador aprobo una orden. Si esta APPROVED, la captura. Solo devuelve paid=true cuando PayPal confirma el estado COMPLETED.',
      inputSchema: finalizePayPalPaymentInputSchema,
      outputSchema: finalizePayPalPaymentOutputShape,
      annotations: {
        title: 'Confirmar pago PayPal (Sandbox)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    createFinalizePayPalPaymentHandler({ paypalClient: deps.paypalClient, logger: deps.logger })
  );

  return server;
}
