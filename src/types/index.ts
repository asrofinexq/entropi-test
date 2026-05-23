// src/types/index.ts

export interface EventLog {
  id: string;
  aggregateId: string;
  eventType: 'OrderCreated' | 'PaymentConfirmed' | 'FeeCalculated' | 'SettlementProcessed';
  payload: {
    amount?: string;
    feeAmount?: string;
    chargeId?: string;
    date?: string;
    [key: string]: string | undefined;
  };
  version: number;
  timestamp: string;
}

export interface LedgerEntry {
  id: string;
  orderId: string;
  account: string;
  debit: string | null;
  credit: string | null;
  timestamp: string;
}