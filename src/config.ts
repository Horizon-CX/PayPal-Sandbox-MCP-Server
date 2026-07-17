import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PAYPAL_CLIENT_ID: z.string().min(1, 'PAYPAL_CLIENT_ID is required'),
  PAYPAL_CLIENT_SECRET: z.string().min(1, 'PAYPAL_CLIENT_SECRET is required'),
  PAYPAL_ENVIRONMENT: z.literal('sandbox').default('sandbox'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

export type AppConfig = {
  paypal: {
    clientId: string;
    clientSecret: string;
    environment: 'sandbox';
    apiBaseUrl: string;
  };
  publicBaseUrl: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
};

const PAYPAL_SANDBOX_API_BASE_URL = 'https://api-m.sandbox.paypal.com';

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const env = parsed.data;
  return {
    paypal: {
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      environment: env.PAYPAL_ENVIRONMENT,
      apiBaseUrl: PAYPAL_SANDBOX_API_BASE_URL
    },
    publicBaseUrl: env.PUBLIC_BASE_URL,
    port: env.PORT,
    logLevel: env.LOG_LEVEL
  };
}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}
