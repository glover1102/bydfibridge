import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { parseTradingViewSignal } from '../webhook/schema.js';
import { constantTimeEquals, isSourceIpAllowed } from '../webhook/auth.js';
import type { DedupeStore } from '../store/dedupe-store.js';
import type { TradeOrchestrator } from '../execution/orchestrator.js';
import type { LogStore } from '../store/log-store.js';
import { validateSignalInput } from '../webhook/validation.js';

export interface ExecutionQueue {
  enqueue(task: () => Promise<void>): void;
}

interface AppDependencies {
  config: AppConfig;
  dedupeStore: DedupeStore;
  orchestrator: TradeOrchestrator;
  queue: ExecutionQueue;
  logStore: LogStore;
  getTradingEnabled: () => boolean;
  setTradingEnabled: (enabled: boolean) => void;
  getPositions: () => Promise<unknown>;
  getOrders: () => Promise<unknown>;
}

const adminHeaderSchema = z.object({
  'admin-token': z.string().min(1).optional(),
  'x-admin-token': z.string().min(1).optional()
});

const withAdminAuth = async (request: FastifyRequest, reply: FastifyReply, config: AppConfig): Promise<boolean> => {
  const headers = adminHeaderSchema.parse(request.headers);
  const token = headers['admin-token'] ?? headers['x-admin-token'];
  if (!token || !constantTimeEquals(token, config.adminToken)) {
    await reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

export const createExecutionQueue = (): ExecutionQueue => {
  let current = Promise.resolve();
  return {
    enqueue(task) {
      current = current.then(task).catch(() => undefined);
    }
  };
};

export const createApp = (deps: AppDependencies): FastifyInstance => {
  const app = Fastify({ logger: true });
  const startedAt = Date.now();

  app.get('/health', async () => ({ ok: true, tradingEnabled: deps.getTradingEnabled(), uptime: Math.floor((Date.now() - startedAt) / 1000) }));

  app.register(async (webhookApp) => {
    await webhookApp.register(rateLimit, { global: false });

    webhookApp.post('/webhook/tradingview', {
      config: {
        rateLimit: {
          max: deps.config.webhookRateLimitMax,
          timeWindow: deps.config.webhookRateLimitWindow
        }
      }
    }, async (request, reply) => {
      const sourceIp = request.ip;
      if (!isSourceIpAllowed(sourceIp, deps.config.allowedSourceIps)) {
        deps.logStore.add('warn', 'Rejected webhook from disallowed IP', { sourceIp });
        return reply.code(403).send({ error: 'Forbidden' });
      }

      let signal;
      try {
        signal = parseTradingViewSignal(request.body);
      } catch (error) {
        const issues = error instanceof z.ZodError ? error.issues : undefined;
        deps.logStore.add('warn', 'Rejected invalid webhook payload', { issues });
        return reply.code(400).send({ error: 'Invalid payload', issues });
      }

      if (!constantTimeEquals(signal.token, deps.config.webhookToken)) {
        deps.logStore.add('warn', 'Rejected webhook with invalid token', { signalId: signal.signal_id });
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        validateSignalInput(signal, deps.config);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid payload';
        deps.logStore.add('warn', 'Rejected webhook during semantic validation', { signalId: signal.signal_id, message });
        return reply.code(400).send({ error: message });
      }

      if (!deps.dedupeStore.reserve(signal.signal_id)) {
        deps.logStore.add('info', 'Duplicate signal ignored', { signalId: signal.signal_id });
        return reply.code(200).send({ accepted: false, signal_id: signal.signal_id, reason: 'duplicate' });
      }

      deps.queue.enqueue(async () => {
        try {
          await deps.orchestrator.process(signal);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown execution error';
          deps.logStore.add('error', 'Signal execution failed', { signalId: signal.signal_id, message });
        }
      });

      deps.logStore.add('info', 'Signal accepted', { signalId: signal.signal_id, action: signal.action });
      return reply.code(200).send({ accepted: true, signal_id: signal.signal_id });
    });
  });

  app.register(async (adminApp) => {
    await adminApp.register(rateLimit, { global: false });

    adminApp.get('/positions', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      if (!await withAdminAuth(request, reply, deps.config)) {
        return;
      }
      return deps.getPositions();
    });

    adminApp.get('/orders', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      if (!await withAdminAuth(request, reply, deps.config)) {
        return;
      }
      return deps.getOrders();
    });

    adminApp.get('/logs', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      if (!await withAdminAuth(request, reply, deps.config)) {
        return;
      }
      return deps.logStore.list();
    });

    adminApp.post('/admin/kill', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      if (!await withAdminAuth(request, reply, deps.config)) {
        return;
      }
      deps.setTradingEnabled(false);
      deps.logStore.add('warn', 'Trading disabled via admin endpoint');
      return { tradingEnabled: deps.getTradingEnabled() };
    });

    adminApp.post('/admin/enable', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
      if (!await withAdminAuth(request, reply, deps.config)) {
        return;
      }
      deps.setTradingEnabled(true);
      deps.logStore.add('info', 'Trading enabled via admin endpoint');
      return { tradingEnabled: deps.getTradingEnabled() };
    });
  });

  return app;
};
