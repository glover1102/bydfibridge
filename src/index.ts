import { loadConfig } from './config/env.js';
import { BydfiClient } from './bydfi/client.js';
import { loadSymbolSpecsFromExchange, mergeSymbolSpecs } from './bydfi/symbol-specs.js';
import { RiskEngine } from './risk/risk-engine.js';
import { TradeStore } from './store/trade-store.js';
import { PersistentDedupeStore } from './store/dedupe-store.js';
import { LogStore } from './store/log-store.js';
import { DiscordNotifier } from './notify/discord.js';
import { TradeOrchestrator } from './execution/orchestrator.js';
import { TradeManager } from './execution/trade-manager.js';
import { createApp, createExecutionQueue } from './server/app.js';

const config = loadConfig();
const tradeStore = new TradeStore(config.tradeStoreFile);
const logStore = new LogStore(config.logStoreLimit);
const dedupeStore = new PersistentDedupeStore(config.dedupeStoreFile, config.dedupeTtlMs);
const notifier = new DiscordNotifier(config.discordWebhookUrl);
const bydfiClient = new BydfiClient(config);
const envSymbolSpecs = { ...config.symbolSpecs };
let exchangeSymbolSpecs: typeof config.symbolSpecs = {};
const queue = createExecutionQueue();
const requestedTradingEnabled = config.tradingEnabled;

const tradingState = { enabled: config.tradingEnabled };
const isTradingEnabled = (): boolean => tradingState.enabled;
const setTradingEnabled = (enabled: boolean): void => {
  tradingState.enabled = enabled;
  config.tradingEnabled = enabled;
};
const riskEngine = new RiskEngine(config, tradeStore, isTradingEnabled);
const orchestrator = new TradeOrchestrator(config, bydfiClient, riskEngine, tradeStore, logStore, notifier);
const app = createApp({
  config,
  dedupeStore,
  orchestrator,
  queue,
  logStore,
  getTradingEnabled: isTradingEnabled,
  setTradingEnabled,
  getPositions: () => bydfiClient.getPositions(),
  getOrders: () => bydfiClient.getOpenOrders()
});

const tradeManager = new TradeManager(
  config,
  bydfiClient,
  tradeStore,
  logStore,
  notifier,
  (symbol) => riskEngine.getSymbolSpec(symbol).priceTick
);
let tradeManagerStarted = false;
let symbolSpecAutoDisabledTrading = false;

const ensureTradeManagerStarted = (): void => {
  if (tradeManagerStarted) {
    return;
  }
  tradeManager.start();
  tradeManagerStarted = true;
};

const refreshSymbolSpecs = async (): Promise<void> => {
  const nextExchangeSymbolSpecs = await loadSymbolSpecsFromExchange(bydfiClient, app.log);
  if (Object.keys(nextExchangeSymbolSpecs).length > 0) {
    exchangeSymbolSpecs = nextExchangeSymbolSpecs;
  }

  config.symbolSpecs = mergeSymbolSpecs(exchangeSymbolSpecs, envSymbolSpecs);
  if (Object.keys(config.symbolSpecs).length > 0) {
    if (symbolSpecAutoDisabledTrading && requestedTradingEnabled) {
      setTradingEnabled(true);
      symbolSpecAutoDisabledTrading = false;
      app.log.info('Trading re-enabled after symbol specs were loaded');
    }
    ensureTradeManagerStarted();
  }
};

const scheduleSymbolSpecRefresh = (): void => {
  if (config.symbolSpecsRefreshMs <= 0) {
    return;
  }
  const timer = setInterval(() => {
    void refreshSymbolSpecs().catch((error) => {
      app.log.warn({ err: error }, 'Failed to refresh symbol specs from BYDFi exchange info');
    });
  }, config.symbolSpecsRefreshMs);
  timer.unref();
};

const start = async (): Promise<void> => {
  try {
    await refreshSymbolSpecs();
  } catch (error) {
    app.log.warn({ err: error }, 'Failed to load symbol specs from BYDFi exchange info; continuing with env specs only');
  }
  if (Object.keys(config.symbolSpecs).length === 0) {
    setTradingEnabled(false);
    symbolSpecAutoDisabledTrading = requestedTradingEnabled;
    app.log.warn('No symbol specs available from BYDFi exchange info or SYMBOL_SPECS overrides; trading has been disabled until specs are configured or refreshed');
  }
  scheduleSymbolSpecRefresh();
  if (Object.keys(config.symbolSpecs).length > 0) {
    ensureTradeManagerStarted();
  }
  await app.listen({ host: '0.0.0.0', port: config.port });
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
