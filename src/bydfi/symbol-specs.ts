import type { BydfiClientLike } from './client.js';
import type { SymbolSpec } from '../execution/types.js';

const SYMBOL_ARRAY_KEYS = ['symbols', 'data', 'list'] as const;
const STEP_FIELD_CANDIDATES = ['qtyStep', 'quantityStep', 'stepSize', 'lotSize', 'quantity_step'] as const;
const STEP_PRECISION_FIELD_CANDIDATES = ['quantityPrecision', 'qtyPrecision', 'volumePrecision', 'basePrecision'] as const;
const PRICE_FIELD_CANDIDATES = ['priceTick', 'tickSize', 'priceStep', 'price_tick'] as const;
const PRICE_PRECISION_FIELD_CANDIDATES = ['pricePrecision', 'quotePrecision'] as const;
const SYMBOL_FIELD_CANDIDATES = ['symbol', 'symbolName', 'symbolCode', 'contract', 'pair'] as const;
type SymbolSpecsLogger = Pick<Console, 'warn'>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const parsePositiveNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
};

const parseNonNegativeInteger = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
};

const parsePrecisionStep = (value: unknown): number | undefined => {
  const precision = parseNonNegativeInteger(value);
  if (precision === undefined) {
    return undefined;
  }
  return 10 ** -precision;
};

const getFirstParsedValue = (
  source: Record<string, unknown>,
  fieldNames: readonly string[],
  parser: (value: unknown) => number | undefined
): number | undefined => {
  for (const fieldName of fieldNames) {
    const parsed = parser(source[fieldName]);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
};

const extractSymbolsArray = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }

  for (const key of SYMBOL_ARRAY_KEYS) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (isRecord(candidate)) {
      for (const nestedKey of SYMBOL_ARRAY_KEYS) {
        if (Array.isArray(candidate[nestedKey])) {
          return candidate[nestedKey] as unknown[];
        }
      }
    }
  }

  return [];
};

const parseSymbolName = (entry: Record<string, unknown>): string | undefined => {
  for (const fieldName of SYMBOL_FIELD_CANDIDATES) {
    const value = entry[fieldName];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const parseSymbolSpec = (entry: Record<string, unknown>): SymbolSpec | undefined => {
  const qtyStep = getFirstParsedValue(entry, STEP_FIELD_CANDIDATES, parsePositiveNumber)
    ?? getFirstParsedValue(entry, STEP_PRECISION_FIELD_CANDIDATES, parsePrecisionStep);
  const priceTick = getFirstParsedValue(entry, PRICE_FIELD_CANDIDATES, parsePositiveNumber)
    ?? getFirstParsedValue(entry, PRICE_PRECISION_FIELD_CANDIDATES, parsePrecisionStep);

  if (qtyStep === undefined || priceTick === undefined) {
    return undefined;
  }

  return { qtyStep, priceTick };
};

export const mergeSymbolSpecs = (
  exchangeSymbolSpecs: Record<string, SymbolSpec>,
  envSymbolSpecs: Record<string, SymbolSpec>
): Record<string, SymbolSpec> => ({
  ...exchangeSymbolSpecs,
  ...envSymbolSpecs
});

export const loadSymbolSpecsFromExchange = async (
  client: BydfiClientLike,
  logger: SymbolSpecsLogger = console
): Promise<Record<string, SymbolSpec>> => {
  const payload = await client.getExchangeInfo();
  const entries = extractSymbolsArray(payload);
  const symbolSpecs: Record<string, SymbolSpec> = {};
  const skippedEntries: string[] = [];

  entries.forEach((entry, index) => {
    if (!isRecord(entry)) {
      skippedEntries.push(`entry#${index + 1}`);
      return;
    }

    const symbol = parseSymbolName(entry);
    const spec = parseSymbolSpec(entry);

    if (!symbol || !spec) {
      skippedEntries.push(symbol ?? `entry#${index + 1}`);
      return;
    }

    symbolSpecs[symbol] = spec;
  });

  if (skippedEntries.length > 0) {
    logger.warn(`Skipped unparseable exchange symbol specs: ${skippedEntries.join(', ')}`);
  }

  return symbolSpecs;
};
