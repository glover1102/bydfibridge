import type { SymbolSpec } from '../execution/types.js';

const toPositiveNumber = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const precisionToStep = (precision: unknown): number | undefined => {
  const digits = toPositiveNumber(precision);
  if (digits === undefined || !Number.isInteger(digits)) {
    return undefined;
  }

  return Number((10 ** -digits).toFixed(digits));
};

const toSymbolSpec = (entry: Record<string, unknown>): SymbolSpec | undefined => {
  const qtyStep = toPositiveNumber(entry.qtyStep)
    ?? toPositiveNumber(entry.quantityStep)
    ?? toPositiveNumber(entry.stepSize)
    ?? toPositiveNumber(entry.volumeStep)
    ?? precisionToStep(entry.volumePrecision)
    ?? precisionToStep(entry.basePrecision);
  const priceTick = toPositiveNumber(entry.priceTick)
    ?? toPositiveNumber(entry.tickSize)
    ?? toPositiveNumber(entry.priceStep)
    ?? precisionToStep(entry.priceOrderPrecision)
    ?? precisionToStep(entry.pricePrecision);

  if (qtyStep === undefined || priceTick === undefined) {
    return undefined;
  }

  return { qtyStep, priceTick };
};

const getExchangeEntries = (exchangeInfo: unknown): Record<string, unknown>[] => {
  if (Array.isArray(exchangeInfo)) {
    return exchangeInfo.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
  }
  if (!exchangeInfo || typeof exchangeInfo !== 'object') {
    return [];
  }

  const candidates = ['symbols', 'list', 'rows', 'result', 'data']
    .map((key) => (exchangeInfo as Record<string, unknown>)[key])
    .find(Array.isArray);

  return Array.isArray(candidates)
    ? candidates.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
};

export const loadRuntimeSymbolSpecs = (
  exchangeInfo: unknown,
  overrides: Record<string, SymbolSpec> = {}
): Record<string, SymbolSpec> => {
  const specs = Object.fromEntries(
    getExchangeEntries(exchangeInfo)
      .map((entry) => {
        const symbol = typeof entry.symbol === 'string' ? entry.symbol.toUpperCase() : undefined;
        const spec = toSymbolSpec(entry);
        return symbol && spec ? [symbol, spec] : undefined;
      })
      .filter((entry): entry is [string, SymbolSpec] => entry !== undefined)
  );

  return { ...specs, ...overrides };
};
