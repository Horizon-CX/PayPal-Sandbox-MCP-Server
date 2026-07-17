import type { PayPalErrorBody, PayPalErrorDetail } from './paypalTypes.js';

/** Base class for all domain errors raised while talking to PayPal. Never carries credentials or tokens. */
export abstract class PayPalDomainError extends Error {
  abstract readonly code: string;
}

export class PayPalApiError extends PayPalDomainError {
  readonly code = 'PAYPAL_API_ERROR';
  readonly httpStatus: number;
  readonly paypalDebugId: string | undefined;
  readonly paypalName: string | undefined;
  readonly details: PayPalErrorDetail[];

  constructor(httpStatus: number, body: PayPalErrorBody | undefined, fallbackMessage: string) {
    super(body?.message ?? fallbackMessage);
    this.name = 'PayPalApiError';
    this.httpStatus = httpStatus;
    this.paypalDebugId = body?.debug_id;
    this.paypalName = body?.name;
    this.details = body?.details ?? [];
  }

  hasIssue(issue: string): boolean {
    return this.details.some((detail) => detail.issue === issue);
  }
}

export class PayPalTimeoutError extends PayPalDomainError {
  readonly code = 'PAYPAL_TIMEOUT';

  constructor(operation: string) {
    super(`Timed out while calling PayPal (${operation})`);
    this.name = 'PayPalTimeoutError';
  }
}

export class PayPalMissingApprovalLinkError extends PayPalDomainError {
  readonly code = 'PAYPAL_MISSING_APPROVAL_LINK';

  constructor(paypalOrderId: string) {
    super(`PayPal order ${paypalOrderId} did not include an approval link (approve/payer-action)`);
    this.name = 'PayPalMissingApprovalLinkError';
  }
}

export function isPayPalDomainError(error: unknown): error is PayPalDomainError {
  return error instanceof PayPalDomainError;
}

export function toSafeErrorMessage(error: unknown): string {
  if (isPayPalDomainError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return 'An unexpected error occurred while processing the PayPal request.';
  }
  return 'An unknown error occurred.';
}
