// src/types/index.ts

export interface EventLog {
  id: string;
  aggregateId: string;
  eventType: 'OrderCreated' | 'PaymentConfirmed' | 'FeeCalculated' | 'SettlementProcessed';
  payload: Record<string, string | undefined>;
  version: number;
  timestamp: string;
  idempotencyKey: string;
}

export interface LedgerEntry {
  id: string;
  orderId: string;
  account: string;
  debit: string | null;
  credit: string | null;
  timestamp: string;
}