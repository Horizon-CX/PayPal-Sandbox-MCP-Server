import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Logger } from 'pino';
import type { PayPalClient } from '../paypal/paypalClient.js';
import { createMcpServer } from '../mcp/createServer.js';
import { createErrorHandler } from './errorHandler.js';

const JSON_BODY_LIMIT = '256kb';

export interface CreateAppDeps {
  paypalClient: PayPalClient;
  publicBaseUrl: string;
  environment: 'sandbox';
  logger: Logger;
}

function renderHtmlPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body style="font-family: system-ui, sans-serif; text-align: center; margin-top: 4rem; color: #1a1a1a;">
    <p>${message}</p>
  </body>
</html>`;
}

function hasJsonContentType(req: Request): boolean {
  const contentType = req.headers['content-type'];
  return typeof contentType === 'string' && contentType.includes('application/json');
}

const REQUIRED_MCP_ACCEPT = 'application/json, text/event-stream';

function normalizeAcceptHeader(req: Request): void {
  const raw = req.rawHeaders;
  let found = false;
  for (let i = 0; i < raw.length; i += 2) {
    const key = raw[i];
    const value = raw[i + 1];
    if (key === undefined || value === undefined) {
      continue;
    }
    if (key.toLowerCase() === 'accept') {
      if (!value.includes('application/json') || !value.includes('text/event-stream')) {
        raw[i + 1] = REQUIRED_MCP_ACCEPT;
      }
      found = true;
    }
  }
  if (!found) {
    raw.push('Accept', REQUIRED_MCP_ACCEPT);
  }
  req.headers.accept = REQUIRED_MCP_ACCEPT;
}

export function createApp(deps: CreateAppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'UP', environment: deps.environment, mcpEndpoint: '/mcp' });
  });

  app.get('/paypal/return', (_req: Request, res: Response) => {
    res
      .type('html')
      .send(renderHtmlPage('Pago aprobado', 'Pago aprobado en PayPal Sandbox. Ya puedes volver al chat y confirmar que has pagado.'));
  });

  app.get('/paypal/cancel', (_req: Request, res: Response) => {
    res.type('html').send(renderHtmlPage('Pago cancelado', 'Pago cancelado. Puedes volver al chat.'));
  });

  const handleMcpRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.method === 'POST' && !hasJsonContentType(req)) {
        res.status(415).json({ error: 'Unsupported Media Type: expected application/json' });
        return;
      }

      // El SDK exige, sin excepcion, que el header Accept incluya tanto application/json
      // como text/event-stream en cada POST (ver handlePostRequest en el SDK); clientes
      // que no negocian SSE (como el planner de Agentforce) no lo mandan y reciben 406
      // antes de que el handshake MCP llegue a empezar. @hono/node-server (usado por el
      // transporte para convertir la request de Node a Web Standard) construye los headers
      // a partir de req.rawHeaders, no de req.headers, asi que hay que normalizar ahi.
      normalizeAcceptHeader(req);

      // Stateless mode: a fresh server + transport pair per request, as recommended by the MCP SDK
      // for deployments with no shared session state between requests.
      const server = createMcpServer({
        paypalClient: deps.paypalClient,
        publicBaseUrl: deps.publicBaseUrl,
        logger: deps.logger
      });
      // enableJsonResponse: la respuesta real es un JSON plano (no un stream SSE), que es
      // lo que un cliente HTTP simple como el de Salesforce necesita para parsear el resultado.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      res.on('close', () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body as unknown);
    } catch (error) {
      next(error);
    }
  };

  app.post('/mcp', (req, res, next) => {
    void handleMcpRequest(req, res, next);
  });
  app.get('/mcp', (req, res, next) => {
    void handleMcpRequest(req, res, next);
  });
  app.delete('/mcp', (req, res, next) => {
    void handleMcpRequest(req, res, next);
  });

  app.use(createErrorHandler(deps.logger));

  return app;
}
