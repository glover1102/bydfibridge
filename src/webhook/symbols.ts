const KNOWN_QUOTES = ['USDT', 'USDC', 'USD'] as const;

export const normalizeTradingViewSymbol = (raw: string, overrides: Record<string, string> = {}): string => {
  const trimmed = raw.trim().toUpperCase();
  if (overrides[trimmed]) {
    return overrides[trimmed];
  }

  const withoutPrefix = trimmed.includes(':') ? trimmed.split(':', 2)[1] ?? trimmed : trimmed;
  const compact = withoutPrefix.replace(/\.P$/i, '').replace(/-/g, '');
  if (overrides[compact]) {
    return overrides[compact];
  }
  if (/^[A-Z]+-[A-Z]+$/.test(withoutPrefix)) {
    return withoutPrefix;
  }

  for (const quote of KNOWN_QUOTES) {
    if (compact.endsWith(quote)) {
      const base = compact.slice(0, -quote.length);
      if (!base) {
        break;
      }
      return `${base}-${quote === 'USD' ? 'USDT' : quote}`;
    }
  }

  throw new Error(`Unknown symbol: ${raw}`);
};
