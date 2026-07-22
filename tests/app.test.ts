import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import pino from 'pino';
import { createApp } from '../src/http/app.js';
import type { PayPalClient } from '../src/paypal/paypalClient.js';

const silentLogger = pino({ level: 'silent' });

function fakePayPalClient(): PayPalClient {
  return {
    createOrder: vi.fn(),
    getOrder: vi.fn(),
    captureOrder: vi.fn()
  } as unknown as PayPalClient;
}

describe('POST /mcp Accept header handling', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = createApp({
      paypalClient: fakePayPalClient(),
      publicBaseUrl: 'https://demo.example.com',
      environment: 'sandbox',
      logger: silentLogger
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected an AddressInfo from the HTTP server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function callToolsList(acceptHeader?: string): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (acceptHeader !== undefined) {
      headers.Accept = acceptHeader;
    }
    return fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
  }

  it('succeeds with the fully-compliant Accept header', async () => {
    const response = await callToolsList('application/json, text/event-stream');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { result?: { tools?: unknown[] } };
    expect(body.result?.tools).toHaveLength(2);
  });

  it('succeeds when the client only accepts application/json (e.g. Agentforce)', async () => {
    const response = await callToolsList('application/json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('succeeds when no Accept header is sent at all', async () => {
    const response = await callToolsList(undefined);
    expect(response.status).toBe(200);
  });

  it('succeeds with a generic Accept: */*', async () => {
    const response = await callToolsList('*/*');
    expect(response.status).toBe(200);
  });
});
