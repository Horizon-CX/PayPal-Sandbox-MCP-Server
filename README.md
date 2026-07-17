# PayPal Sandbox MCP Server

Servidor MCP remoto (Streamable HTTP) que expone dos tools de pago contra **PayPal Sandbox**, pensado exclusivamente para una demo de Salesforce Agentforce. **Sin autenticación en el endpoint `/mcp`** — solo apto para esta demo, nunca para producción.

## 1. Requisitos

- Node.js >= 20
- Una app de PayPal Developer (Sandbox) con `Client ID` y `Client Secret`

## 2. Instalación

```bash
cd paypal-mcp-server
npm install
```

## 3. Variables de entorno

Copia `.env.example` a `.env` y rellena tus credenciales de Sandbox:

```bash
cp .env.example .env
```

| Variable | Descripción | Por defecto |
|---|---|---|
| `PAYPAL_CLIENT_ID` | Client ID de tu app de PayPal Sandbox | *(obligatorio)* |
| `PAYPAL_CLIENT_SECRET` | Client Secret de tu app de PayPal Sandbox | *(obligatorio)* |
| `PAYPAL_ENVIRONMENT` | Debe ser `sandbox` | `sandbox` |
| `PUBLIC_BASE_URL` | URL pública donde se desplegará este servidor (se usa para `return_url`/`cancel_url`) | `http://localhost:3000` |
| `PORT` | Puerto HTTP | `3000` |
| `LOG_LEVEL` | Nivel de log de pino | `info` |

El servidor nunca registra `Client Secret`, tokens de acceso ni cabeceras `Authorization` (ver `src/logger.ts`).

## 4. Arrancar localmente

```bash
npm run dev
```

o compilado:

```bash
npm run build
npm start
```

## 5. Probar `GET /health`

```bash
curl http://localhost:3000/health
```

Respuesta esperada:

```json
{ "status": "UP", "environment": "sandbox", "mcpEndpoint": "/mcp" }
```

## 6. Probarlo con MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

En la UI del Inspector, elige transporte **Streamable HTTP** y apunta a `http://localhost:3000/mcp`. Deberías poder listar las tools `create_paypal_payment` y `finalize_paypal_payment` y ejecutarlas.

## 7. Despliegue

Cualquier hosting Node 20 sirve (Render, Railway, Fly.io, etc.). Con el `Dockerfile` incluido (multi-stage, usuario no root):

```bash
docker build -t paypal-mcp-server .
docker run -p 3000:3000 --env-file .env paypal-mcp-server
```

Este proyecto vive en el repo público [`Horizon-CX/paypal-sandbox-mcp-server`](https://github.com/Horizon-CX/paypal-sandbox-mcp-server) — puedes conectarlo directamente desde Render/Railway como origen de despliegue continuo.

## 8. Variables de entorno en el hosting

Configura en el panel del proveedor (Render/Railway/Fly.io):

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENVIRONMENT=sandbox`
- `PUBLIC_BASE_URL` → la URL pública final asignada por el hosting (por ejemplo `https://paypal-mcp-demo.onrender.com`)
- `PORT` → normalmente la inyecta el propio hosting; déjala solo si el proveedor lo requiere explícito

## 9. Registrar el servidor en Salesforce

En Setup → MCP Servers → New:

| Campo | Valor |
|---|---|
| MCP Server Name | `PayPal Sandbox Payments` |
| Server URL | `https://<dominio-publico>/mcp` |
| Authentication Method | `No Authentication` |

> ⚠️ **"No Authentication" solo es aceptable para esta demo con PayPal Sandbox. No debe utilizarse así en producción.**

## 10. Tools a seleccionar

- `create_paypal_payment`
- `finalize_paypal_payment`

## 11. Ejemplos de input/output

### `create_paypal_payment`

Input:

```json
{
  "salesforceOrderId": "801xx0000000001",
  "orderNumber": "ORD-00001",
  "amount": "49.99",
  "currency": "EUR",
  "description": "Pedido demo Agentforce"
}
```

Output (`structuredContent`):

```json
{
  "success": true,
  "salesforceOrderId": "801xx0000000001",
  "orderNumber": "ORD-00001",
  "paypalOrderId": "5O190127TN364715T",
  "approvalUrl": "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
  "status": "CREATED",
  "paid": false,
  "amount": "49.99",
  "currency": "EUR"
}
```

### `finalize_paypal_payment`

Input:

```json
{
  "salesforceOrderId": "801xx0000000001",
  "paypalOrderId": "5O190127TN364715T"
}
```

Output cuando el comprador ya aprobó y se captura correctamente:

```json
{
  "success": true,
  "salesforceOrderId": "801xx0000000001",
  "paypalOrderId": "5O190127TN364715T",
  "paypalStatus": "COMPLETED",
  "paymentStatus": "PAID",
  "paid": true,
  "captureId": "3C679366NW308354M",
  "amount": "49.99",
  "currency": "EUR"
}
```

Output cuando el comprador aún no ha aprobado:

```json
{
  "success": true,
  "salesforceOrderId": "801xx0000000001",
  "paypalOrderId": "5O190127TN364715T",
  "paypalStatus": "CREATED",
  "paymentStatus": "PENDING_CUSTOMER_APPROVAL",
  "paid": false,
  "amount": "49.99",
  "currency": "EUR"
}
```

## 12. Advertencia

**`No Authentication` solo es aceptable para esta demo con PayPal Sandbox. No debe utilizarse así en producción.** Cualquier despliegue real de este patrón necesita autenticación en el endpoint `/mcp` (OAuth, API key, mTLS, etc.).

## 13. Crear un comprador PayPal Sandbox y aprobar el enlace

1. Entra en [developer.paypal.com](https://developer.paypal.com/dashboard/accounts) → **Sandbox → Accounts**.
2. Usa la cuenta personal (buyer) de sandbox que PayPal crea por defecto, o crea una nueva de tipo **Personal**.
3. Copia su email y contraseña de sandbox (botón "..." → **View/edit account** → **Profile**).
4. Abre el `approvalUrl` devuelto por `create_paypal_payment` en un navegador.
5. Inicia sesión con las credenciales del comprador sandbox del paso 3.
6. Aprueba el pago ficticio.
7. Verás la página `/paypal/return` de este servidor confirmando la aprobación.
8. Vuelve al chat de Agentforce y confirma que has pagado — esto debe disparar `finalize_paypal_payment`.

## Scripts

| Script | Descripción |
|---|---|
| `npm run dev` | Arranca en modo desarrollo con recarga (`tsx watch`) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Ejecuta el build compilado |
| `npm test` | Ejecuta los tests con Vitest |
| `npm run lint` | ESLint sobre `src` y `tests` |
| `npm run typecheck` | Comprueba tipos sin emitir (`src` + `tests`) |

## Arquitectura

```
src/
  index.ts                    Bootstrap: config, servidor HTTP, graceful shutdown
  config.ts                   Validación de variables de entorno (Zod)
  logger.ts                   Logger pino con redacción de secretos
  paypal/
    paypalClient.ts           Cliente PayPal: OAuth2 con cache de token, createOrder/getOrder/captureOrder
    paypalTypes.ts            Tipos de las respuestas de PayPal
    paypalErrors.ts           Errores de dominio (nunca exponen credenciales/tokens)
  mcp/
    createServer.ts           Registro de las dos tools MCP
    tools/
      createPayPalPayment.ts
      finalizePayPalPayment.ts
  http/
    app.ts                    Express: /health, /paypal/return, /paypal/cancel, /mcp (POST/GET/DELETE)
    errorHandler.ts           Middleware de errores centralizado
tests/
  paypalClient.test.ts
  createPayPalPayment.test.ts
  finalizePayPalPayment.test.ts
```
