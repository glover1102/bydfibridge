import { loadConfig } from './config/env.js';
import { BydfiClient } from './bydfi/client.js';
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
const riskEngine = new RiskEngine(config, tradeStore);
const orchestrator = new TradeOrchestrator(config, bydfiClient, riskEngine, tradeStore, logStore, notifier);
const queue = createExecutionQueue();

const tradingState = { enabled: config.tradingEnabled };
const app = createApp({
  config,
  dedupeStore,
  orchestrator,
  queue,
  logStore,
  getTradingEnabled: () => tradingState.enabled,
  setTradingEnabled: (enabled) => {
    tradingState.enabled = enabled;
    config.tradingEnabled = enabled;
  },
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
tradeManager.start();

const start = async (): Promise<void> => {
  await app.listen({ host: '0.0.0.0', port: config.port });
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
