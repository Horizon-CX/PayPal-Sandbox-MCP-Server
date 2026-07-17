import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ path: req.path, method: req.method, reason: message }, 'Unhandled request error');
    res.status(500).json({ error: 'Internal Server Error' });
  };
}
