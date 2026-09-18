/**
 * Read-only BYDFi pre-flight check.
 *
 * `loadConfig()` still requires `WEBHOOK_TOKEN` and `ADMIN_TOKEN`, but they can
 * be set to dummy non-empty values for this script because no webhook/admin
 * routes are started and this script never places, modifies, or cancels orders.
 */
import { loadConfig } from '../src/config/env.js';
import { BydfiClient } from '../src/bydfi/client.js';

const config = loadConfig();
const client = new BydfiClient(config);

const truncate = (value: string, limit = 500): string => value.length > limit ? `${value.slice(0, limit)}...` : value;

const summarize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return truncate(JSON.stringify({ count: value.length, sample: value.slice(0, 2) }));
  }
  if (value && typeof value === 'object') {
    return truncate(JSON.stringify(value));
  }
  return truncate(String(value));
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return truncate(error.message);
  }
  return truncate(String(error));
};

const checks = [
  { name: 'getExchangeInfo', run: () => client.getExchangeInfo() },
  { name: 'getBalance', run: () => client.getBalance() },
  { name: 'getPositions', run: () => client.getPositions() },
  { name: 'getOpenOrders', run: () => client.getOpenOrders() }
] as const;

let allPassed = true;

for (const check of checks) {
  try {
    const result = await check.run();
    console.log(`PASS ${check.name}: ${summarize(result)}`);
  } catch (error) {
    allPassed = false;
    console.error(`FAIL ${check.name}: ${formatError(error)}`);
  }
}

process.exitCode = allPassed ? 0 : 1;
