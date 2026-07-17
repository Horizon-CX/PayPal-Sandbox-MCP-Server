import pino from 'pino';
import { getConfig } from './config.js';

export const logger = pino({
  level: getConfig().logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      '*.authorization',
      '*.Authorization',
      '*.accessToken',
      '*.access_token',
      '*.clientSecret',
      '*.client_secret',
      '*.token'
    ],
    censor: '[REDACTED]'
  }
});
