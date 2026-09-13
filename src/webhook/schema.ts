import { z } from 'zod';
import type { TradingViewSignal } from '../execution/types.js';

const nullableNumber = z.union([z.undefined(), z.null(), z.literal(''), z.coerce.number().finite()]).transform((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return value;
});

const payloadSchema = z.object({
  token: z.string().min(1),
  strategy: z.string().min(1),
  signal_id: z.string().min(1),
  action: z.enum(['entry', 'exit', 'close_all']),
  side: z.enum(['long', 'short']).optional(),
  symbol: z.string().min(1),
  leverage: z.coerce.number().positive().optional(),
  risk_percent: z.coerce.number().positive().optional(),
  qty: z.coerce.number().positive().optional(),
  order_type: z.enum(['market', 'limit']).default('market'),
  signal_price: nullableNumber.optional(),
  entry: nullableNumber.optional(),
  stop_loss: nullableNumber.optional(),
  tp1: nullableNumber.optional(),
  tp1_qty: nullableNumber.optional(),
  tp2: nullableNumber.optional(),
  tp2_qty: nullableNumber.optional(),
  tp3: nullableNumber.optional(),
  tp3_qty: nullableNumber.optional(),
  tp4: nullableNumber.optional(),
  tp4_qty: nullableNumber.optional(),
  move_sl_to_be_after: z.enum(['tp1', 'tp2', 'tp3', 'none']).default('none'),
  reverse_on_opposite: z.coerce.boolean().default(false)
}).superRefine((value, ctx) => {
  if (value.action !== 'close_all' && !value.side) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'side is required', path: ['side'] });
  }
  if (value.action === 'entry' && !value.entry) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'entry is required', path: ['entry'] });
  }
  if (value.action === 'entry' && !value.qty && !value.risk_percent) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'qty or risk_percent is required', path: ['qty'] });
  }
});

export const parseTradingViewSignal = (input: unknown): TradingViewSignal => {
  const parsed = payloadSchema.parse(input);
  const takeProfits = ['tp1', 'tp2', 'tp3', 'tp4'].flatMap((name) => {
    const key = name as 'tp1' | 'tp2' | 'tp3' | 'tp4';
    const price = parsed[key];
    if (!price) {
      return [];
    }
    return [{
      name: key,
      price,
      qty: parsed[`${key}_qty` as keyof typeof parsed] as number | undefined
    }];
  });

  return {
    token: parsed.token,
    strategy: parsed.strategy,
    signal_id: parsed.signal_id,
    action: parsed.action,
    side: parsed.side,
    symbol: parsed.symbol,
    leverage: parsed.leverage,
    risk_percent: parsed.risk_percent,
    qty: parsed.qty,
    order_type: parsed.order_type,
    signal_price: parsed.signal_price ?? undefined,
    entry: parsed.entry ?? undefined,
    stop_loss: parsed.stop_loss ?? undefined,
    takeProfits,
    move_sl_to_be_after: parsed.move_sl_to_be_after,
    reverse_on_opposite: parsed.reverse_on_opposite
  };
};
