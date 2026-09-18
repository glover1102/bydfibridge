# QTAlgo Trade Bridge

Production-oriented Node.js + TypeScript bridge for TradingView/QTAlgo alerts that manages BYDFi USDT-M perpetual futures orders.

## Features

- Fastify webhook endpoint with zod validation and constant-time token checks
- Immediate TradingView response with async in-process execution queue
- Persistent signal de-duplication by `signal_id` using JSON-backed storage
- Symbol normalization for TradingView tickers like `BYDFI:BTCUSDT.P` → `BTC-USDT`
- Safety-first risk engine with leverage, position, and daily-loss checks
- BYDFi V2 client wrapper for leverage, margin mode, orders, positions, and balance
- Trade manager for breakeven stop moves after TP fills and closed-trade cleanup
- Admin endpoints for health, positions, orders, logs, and runtime trading enable/kill
- Optional Discord notifications for accepted/rejected/filled/error events
- Railway-ready deployment config

## Architecture

```text
TradingView / QTAlgo
        │ HTTPS Webhook (JSON)
        ▼
┌─────────────────────┐
│ QTAlgo Trade Bridge │
│ • Validate signal   │
│ • Dedupe signal_id  │
│ • Map symbol        │
│ • Risk controls     │
│ • Size position     │
│ • Send BYDFi API    │
│ • Manage SL/TP/BE   │
└──────────┬──────────┘
           │ Signed API request
           ▼
   BYDFi USDT-M Perps
```

## Project layout

```text
src/
  bydfi/
  config/
  execution/
  notify/
  risk/
  server/
  store/
  webhook/
tests/
```

## Environment variables

Copy `.env.example` to `.env` and set the values. Then export that file into your shell before local runs, for example: `set -a && source .env && set +a`. The service reads environment variables from the process environment rather than auto-loading `.env`.

| Variable | Required | Notes |
| --- | --- | --- |
| `WEBHOOK_TOKEN` | yes | Shared secret checked with constant-time comparison |
| `ADMIN_TOKEN` | yes | Required for `/positions`, `/orders`, `/logs`, `/admin/*` |
| `BYDFI_API_KEY` | yes | Read + Perpetual Trading only |
| `BYDFI_API_SECRET` | yes | Never put this in TradingView |
| `BYDFI_WALLET` | no | Defaults to `W001` |
| `TRADING_ENABLED` | no | Defaults to `false` |
| `ALLOWED_SOURCE_IPS` | no | Comma-separated TradingView source IP allowlist |
| `SYMBOL_MAP` | no | JSON override map |
| `SYMBOL_SPECS` | no | Optional JSON override for exchange-loaded qty step + price tick metadata |
| `SYMBOL_LEVERAGE_CAPS` | no | JSON per-symbol leverage caps |
| `MAX_POSITION_SIZE` | no | JSON per-symbol base-coin caps |
| `MAX_OPEN_POSITIONS` | no | Total concurrent positions |
| `MAX_DAILY_LOSS_USDT` | no | Blocks new entries once daily realized PnL falls below `-limit` |
| `MARGIN_MODE` | no | `isolated` or `cross` |
| `DATA_DIR` | no | Persistent dedupe/trade state directory (defaults to `./data`) |
| `BE_OFFSET_TICKS` | no | Offset for breakeven stop replacement |
| `DISCORD_WEBHOOK_URL` | no | Optional notification webhook |
| `WEBHOOK_RATE_LIMIT_MAX` | no | Webhook requests allowed per window (default `60`) |
| `WEBHOOK_RATE_LIMIT_WINDOW` | no | Webhook rate-limit window (default `1 minute`) |

## BYDFi API key setup

Use an API key with only:

- **Read**
- **Perpetual Trading**

Do **not** enable transfer permissions. Bind the API key to the Railway server IP when possible.

> Warning: never place BYDFi API credentials inside TradingView alert JSON or webhook URLs.

## Webhook payload

POST `application/json` to `/webhook/tradingview`.

- `qty` is **base coin**, not contracts.
- `signal_price` is logging only.
- `risk_percent` can replace fixed `qty` sizing.

### LONG alert template

```json
{
  "token": "YOUR_SECRET",
  "strategy": "QTAlgo_MoM_Sniper_V20",
  "signal_id": "{{ticker}}_{{time}}_LONG",
  "action": "entry",
  "side": "long",
  "symbol": "{{ticker}}",
  "leverage": 10,
  "risk_percent": 0.5,
  "qty": 0.05,
  "order_type": "market",
  "signal_price": "{{close}}",
  "entry": {{plot("Entry")}},
  "stop_loss": {{plot("SL")}},
  "tp1": {{plot("TP1")}},
  "tp1_qty": 0.02,
  "tp2": {{plot("TP2")}},
  "tp2_qty": 0.01,
  "tp3": {{plot("TP3")}},
  "tp3_qty": 0.01,
  "tp4": {{plot("TP4")}},
  "tp4_qty": 0.01,
  "move_sl_to_be_after": "tp1",
  "reverse_on_opposite": true
}
```

### SHORT alert template

```json
{
  "token": "YOUR_SECRET",
  "strategy": "QTAlgo_MoM_Sniper_V20",
  "signal_id": "{{ticker}}_{{time}}_SHORT",
  "action": "entry",
  "side": "short",
  "symbol": "{{ticker}}",
  "leverage": 10,
  "risk_percent": 0.5,
  "qty": 0.05,
  "order_type": "market",
  "signal_price": "{{close}}",
  "entry": {{plot("Entry")}},
  "stop_loss": {{plot("SL")}},
  "tp1": {{plot("TP1")}},
  "tp1_qty": 0.02,
  "tp2": {{plot("TP2")}},
  "tp2_qty": 0.01,
  "tp3": {{plot("TP3")}},
  "tp3_qty": 0.01,
  "tp4": {{plot("TP4")}},
  "tp4_qty": 0.01,
  "move_sl_to_be_after": "tp1",
  "reverse_on_opposite": true
}
```

### Exit/close-all examples

```json
{ "token": "YOUR_SECRET", "strategy": "QTAlgo_MoM_Sniper_V20", "signal_id": "BTC_{{time}}_EXIT", "action": "exit", "side": "long", "symbol": "{{ticker}}", "order_type": "market" }
```

```json
{ "token": "YOUR_SECRET", "strategy": "QTAlgo_MoM_Sniper_V20", "signal_id": "ALL_{{time}}", "action": "close_all", "symbol": "BTCUSDT", "order_type": "market" }
```

## Local development

```bash
set -a
source .env
set +a
npm install
npm run dev
```

## Scripts

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run smoke
npm run start
```

`npm run smoke` calls BYDFi balance, positions, and exchange-info endpoints with the current environment variables so you can validate auth/signing before enabling trading.

## Railway deploy

1. Push this repository to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Add a Railway volume, mount it to a persistent path (for example `/data`), and set `DATA_DIR` to that exact mount path. If `DATA_DIR` stays on the ephemeral container filesystem, dedupe and open-trade state are lost on redeploy.
4. Set environment variables from `.env.example`. Required for production: `WEBHOOK_TOKEN`, `ADMIN_TOKEN`, `BYDFI_API_KEY`, `BYDFI_API_SECRET`, and `DATA_DIR` (plus optional `BYDFI_WALLET` if not `W001`).
5. Keep `TRADING_ENABLED=false` until you have verified symbol metadata and API permissions.
6. Deploy. Railway uses `railway.json` with Nixpacks to build/run (`npm run build` + `npm run start`) and health-checks `/health`.

## Endpoints

- `GET /health`
- `POST /webhook/tradingview`
- `GET /positions`
- `GET /orders`
- `GET /logs`
- `POST /admin/kill`
- `POST /admin/enable`

Protected endpoints require the `admin-token` header.

## Notes on BYDFi signing

`src/bydfi/client.ts` centralizes BYDFi signing using `X-API-KEY`, `X-API-TIMESTAMP`, and `X-API-SIGNATURE`, with the signature payload assembled as `accessKey + timestamp + queryString + body`. GET requests sign an empty body, while POST requests sign the JSON request body. At startup, the service loads symbol precision/tick metadata from BYDFi `exchange_info` and then applies any optional `SYMBOL_SPECS` overrides from the environment.
