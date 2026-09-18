import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { SymbolSpec } from '../execution/types.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_TOKEN: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  BYDFI_API_KEY: z.string().min(1),
  BYDFI_API_SECRET: z.string().min(1),
  BYDFI_BASE_URL: z.string().url().default('https://api.bydfi.com'),
  BYDFI_WALLET: z.string().min(1).default('W001'),
  TRADING_ENABLED: z.string().optional().default('false'),
  ALLOWED_SOURCE_IPS: z.string().optional().default(''),
  SYMBOL_MAP: z.string().optional().default('{}'),
  SYMBOL_SPECS: z.string().optional().default('{}'),
  SYMBOL_LEVERAGE_CAPS: z.string().optional().default('{}'),
  MAX_POSITION_SIZE: z.string().optional().default('{}'),
  MAX_LEVERAGE: z.coerce.number().positive().default(20),
  LEVERAGE_EXCEED_ACTION: z.enum(['reject', 'clamp']).default('reject'),
  MAX_OPEN_POSITIONS: z.coerce.number().int().nonnegative().default(3),
  MAX_DAILY_LOSS_USDT: z.coerce.number().nonnegative().optional(),
  REQUIRE_STOP_LOSS: z.string().optional().default('true'),
  REQUIRE_TAKE_PROFIT: z.string().optional().default('false'),
  ALLOW_PYRAMIDING: z.string().optional().default('false'),
  MARGIN_MODE: z.enum(['isolated', 'cross']).default('isolated'),
  BE_OFFSET_TICKS: z.coerce.number().int().nonnegative().default(0),
  MANAGER_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  DEDUPE_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
  DATA_DIR: z.string().min(1).default('./data'),
  DISCORD_WEBHOOK_URL: z.union([z.literal(''), z.string().url()]).optional().default(''),
  LOG_STORE_LIMIT: z.coerce.number().int().positive().default(200),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  WEBHOOK_RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute')
});

const parseBoolean = (value: string): boolean => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

const parseRecord = <T>(value: string, label: string): Record<string, T> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }
    return parsed as Record<string, T>;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${(error as Error).message}`);
  }
};

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  webhookToken: string;
  adminToken: string;
  bydfiApiKey: string;
  bydfiApiSecret: string;
  bydfiBaseUrl: string;
  bydfiWallet: string;
  tradingEnabled: boolean;
  allowedSourceIps: string[];
  symbolMap: Record<string, string>;
  symbolSpecs: Record<string, SymbolSpec>;
  symbolLeverageCaps: Record<string, number>;
  maxPositionSize: Record<string, number>;
  maxLeverage: number;
  leverageExceedAction: 'reject' | 'clamp';
  maxOpenPositions: number;
  maxDailyLossUsdt?: number;
  requireStopLoss: boolean;
  requireTakeProfit: boolean;
  allowPyramiding: boolean;
  marginMode: 'isolated' | 'cross';
  beOffsetTicks: number;
  managerIntervalMs: number;
  dedupeTtlMs: number;
  dataDir: string;
  dedupeStoreFile: string;
  tradeStoreFile: string;
  logStoreLimit: number;
  webhookRateLimitMax: number;
  webhookRateLimitWindow: string;
  discordWebhookUrl?: string;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.parse(env);
  const dataDir = resolve(parsed.DATA_DIR);
  mkdirSync(dataDir, { recursive: true });

  const config: AppConfig = {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    webhookToken: parsed.WEBHOOK_TOKEN,
    adminToken: parsed.ADMIN_TOKEN,
    bydfiApiKey: parsed.BYDFI_API_KEY,
    bydfiApiSecret: parsed.BYDFI_API_SECRET,
    bydfiBaseUrl: parsed.BYDFI_BASE_URL,
    bydfiWallet: parsed.BYDFI_WALLET,
    tradingEnabled: parseBoolean(parsed.TRADING_ENABLED),
    allowedSourceIps: parsed.ALLOWED_SOURCE_IPS.split(',').map((ip) => ip.trim()).filter(Boolean),
    symbolMap: parseRecord<string>(parsed.SYMBOL_MAP, 'SYMBOL_MAP'),
    symbolSpecs: parseRecord<SymbolSpec>(parsed.SYMBOL_SPECS, 'SYMBOL_SPECS'),
    symbolLeverageCaps: parseRecord<number>(parsed.SYMBOL_LEVERAGE_CAPS, 'SYMBOL_LEVERAGE_CAPS'),
    maxPositionSize: parseRecord<number>(parsed.MAX_POSITION_SIZE, 'MAX_POSITION_SIZE'),
    maxLeverage: parsed.MAX_LEVERAGE,
    leverageExceedAction: parsed.LEVERAGE_EXCEED_ACTION,
    maxOpenPositions: parsed.MAX_OPEN_POSITIONS,
    maxDailyLossUsdt: parsed.MAX_DAILY_LOSS_USDT,
    requireStopLoss: parseBoolean(parsed.REQUIRE_STOP_LOSS),
    requireTakeProfit: parseBoolean(parsed.REQUIRE_TAKE_PROFIT),
    allowPyramiding: parseBoolean(parsed.ALLOW_PYRAMIDING),
    marginMode: parsed.MARGIN_MODE,
    beOffsetTicks: parsed.BE_OFFSET_TICKS,
    managerIntervalMs: parsed.MANAGER_INTERVAL_MS,
    dedupeTtlMs: parsed.DEDUPE_TTL_MS,
    dataDir,
    dedupeStoreFile: resolve(dataDir, 'dedupe-store.json'),
    tradeStoreFile: resolve(dataDir, 'trade-store.json'),
    logStoreLimit: parsed.LOG_STORE_LIMIT,
    webhookRateLimitMax: parsed.WEBHOOK_RATE_LIMIT_MAX,
    webhookRateLimitWindow: parsed.WEBHOOK_RATE_LIMIT_WINDOW,
    discordWebhookUrl: parsed.DISCORD_WEBHOOK_URL || undefined
  };

  return config;
};
