import { createHash, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { PayPalApiError, PayPalTimeoutError } from './paypalErrors.js';
import type { CreateOrderInput, PayPalErrorBody, PayPalOrder, PayPalTokenResponse } from './paypalTypes.js';

const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  timeoutMs?: number;
  logger?: Logger;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/** Builds a deterministic PayPal-Request-Id (<= 255 chars) from stable business keys. */
export function buildIdempotencyKey(prefix: string, parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${prefix}-${digest}`;
}

interface HttpRequestOptions {
  method: string;
  path: string;
  operation: string;
  authorization: string;
  contentType: string;
  jsonBody?: unknown;
  rawBody?: string;
  requestId?: string;
}

export class PayPalClient {
  private readonly timeoutMs: number;
  private cachedToken: CachedToken | undefined;
  private pendingTokenRequest: Promise<string> | undefined;

  constructor(private readonly options: PayPalClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    const requestId = buildIdempotencyKey('create', [input.salesforceOrderId, input.orderNumber]);
    const accessToken = await this.getAccessToken();
    return this.httpRequest<PayPalOrder>({
      method: 'POST',
      path: '/v2/checkout/orders',
      operation: 'createOrder',
      authorization: `Bearer ${accessToken}`,
      contentType: 'application/json',
      requestId,
      jsonBody: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: input.salesforceOrderId,
            custom_id: input.orderNumber,
            description: input.description,
            amount: {
              currency_code: input.currency,
              value: input.amount
            }
          }
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: 'PAY_NOW',
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl
            }
          }
        }
      }
    });
  }

  async getOrder(paypalOrderId: string): Promise<PayPalOrder> {
    const accessToken = await this.getAccessToken();
    return this.httpRequest<PayPalOrder>({
      method: 'GET',
      path: `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
      operation: 'getOrder',
      authorization: `Bearer ${accessToken}`,
      contentType: 'application/json'
    });
  }

  async captureOrder(paypalOrderId: string): Promise<PayPalOrder> {
    const requestId = buildIdempotencyKey('capture', [paypalOrderId]);
    const accessToken = await this.getAccessToken();
    return this.httpRequest<PayPalOrder>({
      method: 'POST',
      path: `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      operation: 'captureOrder',
      authorization: `Bearer ${accessToken}`,
      contentType: 'application/json',
      requestId,
      jsonBody: {}
    });
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - TOKEN_EXPIRY_SAFETY_MARGIN_MS > now) {
      return this.cachedToken.accessToken;
    }
    this.pendingTokenRequest ??= this.fetchNewAccessToken().finally(() => {
      this.pendingTokenRequest = undefined;
    });
    return this.pendingTokenRequest;
  }

  private async fetchNewAccessToken(): Promise<string> {
    const basicAuth = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64');
    const token = await this.httpRequest<PayPalTokenResponse>({
      method: 'POST',
      path: '/v1/oauth2/token',
      operation: 'oauthToken',
      authorization: `Basic ${basicAuth}`,
      contentType: 'application/x-www-form-urlencoded',
      rawBody: 'grant_type=client_credentials'
    });

    this.cachedToken = {
      accessToken: token.access_token,
      expiresAtMs: Date.now() + token.expires_in * 1000
    };
    this.options.logger?.debug({ expiresInSeconds: token.expires_in }, 'Obtained new PayPal access token');
    return token.access_token;
  }

  private async httpRequest<T>(opts: HttpRequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    const correlationId = randomUUID();

    try {
      const headers: Record<string, string> = {
        Authorization: opts.authorization,
        'Content-Type': opts.contentType,
        Accept: 'application/json'
      };
      if (opts.requestId) {
        headers['PayPal-Request-Id'] = opts.requestId;
      }

      const body = opts.rawBody ?? (opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined);

      this.options.logger?.info(
        { operation: opts.operation, method: opts.method, path: opts.path, correlationId },
        'Calling PayPal API'
      );

      const response = await fetch(`${this.options.apiBaseUrl}${opts.path}`, {
        method: opts.method,
        headers,
        body,
        signal: controller.signal
      });

      const rawText = await response.text();
      const parsedBody: unknown = rawText.length > 0 ? JSON.parse(rawText) : undefined;

      if (!response.ok) {
        this.options.logger?.warn(
          { operation: opts.operation, httpStatus: response.status, correlationId },
          'PayPal API returned an error response'
        );
        throw new PayPalApiError(
          response.status,
          parsedBody as PayPalErrorBody | undefined,
          `PayPal request failed (${opts.operation})`
        );
      }

      return parsedBody as T;
    } catch (error) {
      if (error instanceof PayPalApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PayPalTimeoutError(opts.operation);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
