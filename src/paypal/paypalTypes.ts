export interface PayPalTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export type PayPalOrderStatus = 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';

export interface PayPalAmount {
  currency_code: string;
  value: string;
}

export interface PayPalCapture {
  id: string;
  status: string;
  amount?: PayPalAmount;
}

export interface PayPalPaymentsCollection {
  captures?: PayPalCapture[];
}

export interface PayPalPurchaseUnit {
  reference_id?: string;
  custom_id?: string;
  amount?: PayPalAmount;
  payments?: PayPalPaymentsCollection;
}

export interface PayPalOrder {
  id: string;
  status: PayPalOrderStatus;
  links?: PayPalLink[];
  purchase_units?: PayPalPurchaseUnit[];
}

export interface PayPalErrorDetail {
  issue?: string;
  description?: string;
  field?: string;
}

export interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: PayPalErrorDetail[];
}

export interface CreateOrderInput {
  salesforceOrderId: string;
  orderNumber: string;
  amount: string;
  currency: string;
  description?: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface CaptureResult {
  order: PayPalOrder;
  capture?: PayPalCapture;
}
