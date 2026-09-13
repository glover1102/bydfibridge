export type TradeSide = 'long' | 'short';
export type ActionType = 'entry' | 'exit' | 'close_all';
export type OrderType = 'market' | 'limit';
export type MoveSlToBeAfter = 'tp1' | 'tp2' | 'tp3' | 'none';

export interface TakeProfitLevel {
  name: 'tp1' | 'tp2' | 'tp3' | 'tp4';
  price: number;
  qty?: number;
}

export interface TradingViewSignal {
  token: string;
  strategy: string;
  signal_id: string;
  action: ActionType;
  side?: TradeSide;
  symbol: string;
  leverage?: number;
  risk_percent?: number;
  qty?: number;
  order_type: OrderType;
  signal_price?: number;
  entry?: number;
  stop_loss?: number;
  takeProfits: TakeProfitLevel[];
  move_sl_to_be_after: MoveSlToBeAfter;
  reverse_on_opposite: boolean;
}

export interface SymbolSpec {
  qtyStep: number;
  priceTick: number;
}

export interface BalanceSnapshot {
  equity: number;
  availableBalance: number;
}

export interface PositionSnapshot {
  symbol: string;
  side: TradeSide;
  qty: number;
  entryPrice: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  triggerPrice?: number;
  price?: number;
  qty: number;
  status?: string;
  reduceOnly?: boolean;
}

export interface PlacedOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  price?: number;
  triggerPrice?: number;
  qty: number;
  filledQty?: number;
  avgFillPrice?: number;
  reduceOnly?: boolean;
}

export interface TradeRecord {
  signalId: string;
  strategy: string;
  symbol: string;
  side: TradeSide;
  leverage: number;
  entryOrderId: string;
  entryFillPrice: number;
  entryFilledQty: number;
  stopLossOrderId: string;
  stopLossPrice: number;
  takeProfitOrderIds: Partial<Record<TakeProfitLevel['name'], string>>;
  takeProfitPrices: Partial<Record<TakeProfitLevel['name'], number>>;
  takeProfitQtys: Partial<Record<TakeProfitLevel['name'], number>>;
  moveSlToBeAfter: MoveSlToBeAfter;
  breakevenMoved: boolean;
  status: 'open' | 'closed' | 'skipped';
  openedAt: string;
  closedAt?: string;
  remainingQty: number;
  realizedPnl?: number;
  lastKnownRealizedPnl?: number;
}

export interface PreparedTrade {
  symbol: string;
  side: TradeSide;
  leverage: number;
  qty: number;
  entry: number;
  stopLoss: number;
  takeProfits: Array<Required<TakeProfitLevel>>;
  orderType: OrderType;
}
