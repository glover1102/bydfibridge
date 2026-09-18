import { loadConfig } from './config/env.js';
import { BydfiClient } from './bydfi/client.js';
import { loadRuntimeSymbolSpecs } from './bydfi/symbol-specs.js';
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
const queue = createExecutionQueue();

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

const start = async (): Promise<void> => {
  const exchangeInfo = await bydfiClient.getExchangeInfo();
  const symbolSpecs = loadRuntimeSymbolSpecs(exchangeInfo, config.symbolSpecs);
  if (Object.keys(symbolSpecs).length === 0) {
    throw new Error('BYDFi exchange_info did not return any symbol specs');
  }
  config.symbolSpecs = symbolSpecs;
  tradeManager.start();
  await app.listen({ host: '0.0.0.0', port: config.port });
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
