import { getConfig } from './config.js';
import { logger } from './logger.js';
import { PayPalClient } from './paypal/paypalClient.js';
import { createApp } from './http/app.js';

function main(): void {
  const config = getConfig();

  const paypalClient = new PayPalClient({
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
    apiBaseUrl: config.paypal.apiBaseUrl,
    logger
  });

  const app = createApp({
    paypalClient,
    publicBaseUrl: config.publicBaseUrl,
    environment: config.paypal.environment,
    logger
  });

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, publicBaseUrl: config.publicBaseUrl, mcpEndpoint: '/mcp' },
      'PayPal MCP server listening'
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    server.close((err) => {
      if (err) {
        logger.error({ reason: err.message }, 'Error while shutting down HTTP server');
        process.exitCode = 1;
      }
      process.exit(process.exitCode ?? 0);
    });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: reason instanceof Error ? reason.message : String(reason) }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ reason: err.message }, 'Uncaught exception');
  });
}

main();
