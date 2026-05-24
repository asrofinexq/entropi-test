# Financial Rules Document

## Core Principle

**Every transaction must balance to zero.**

```
Total Debits = Total Credits = Order Value

If not:
  🚨 STOP EVERYTHING
  🚨 INVESTIGATE
  🚨 ALERT
```

## Number Representation: Decimal(18,4)

### Why Decimal?

JavaScript's `Number` type is IEEE 754 floating-point:

```javascript
//  WRONG
0.1 + 0.2 = 0.30000000000000004

//  FINANCIAL DISASTER
10 × $0.03 = $0.30000000000000004
$999,999.99 + $0.01 = $1,000,000.00000000001
```

### Solution: Decimal(18,4)

**18 total digits, 4 decimal places**

```
Maximum value: $9,999,999,999,999.9999
Precision: $0.0001 (0.01 cents)

Stored in database:
  $100.00 → 1000000 (as integer)
  $99.99 → 999900
  $0.01 → 100
```

### Examples

```typescript
import Decimal from 'decimal.js';

// ✅ CORRECT
const a = new Decimal('0.1');
const b = new Decimal('0.2');
const c = a.plus(b);
console.log(c.toString());  

new Decimal('0.01').times(3).toString();  

const amount = new Decimal('100.00');
const fee = amount.times('0.03');  
const payout = amount.minus(fee);  

await db.ledger.create({
  data: {
    amount: new Decimal('99.99'),
  }
});
```

## Double-Entry Ledger Rules

### Rule 1: Every Transaction Has Two Sides

```
Every entry is a debit-credit pair:

DEBIT  account_A   +$X
CREDIT account_B   -$X

Sum of debits - credits = $0 ✅
```

### Rule 2: One Entry Per Account Per Transaction

```
For payment of $100:

✅ CORRECT:
  DEBIT  payment_received  +$100.00
  CREDIT order_balance     -$100.00

❌ WRONG:
  DEBIT  payment_received  +$100.00
  CREDIT fees_owed         -$100.00  (doesn't match)
```

### Rule 3: Exactly ONE of debit/credit is non-null

```sql
ALTER TABLE "Ledger" 
ADD CONSTRAINT check_exactly_one_debit_or_credit
CHECK (
  (debit IS NOT NULL AND credit IS NULL) OR 
  (debit IS NULL AND credit IS NOT NULL)
);

SELECT * FROM "Ledger"
WHERE NOT (
  (debit IS NOT NULL AND credit IS NULL) OR 
  (debit IS NULL AND credit IS NOT NULL)
);
```

## Account Types

### account_balance
- **Purpose**: Tracks order amount owed by customer
- **Nature**: Liability (seller owes goods)
- **Entry**:
  - DEBIT when order created (seller now owes goods)
  - CREDIT when payment received (liability discharged)

### payment_received
- **Purpose**: Tracks money confirmed from customer
- **Nature**: Asset (money in seller's account)
- **Entry**:
  - DEBIT when payment confirmed (money received)
  - CREDIT when fees taken or payout made (money distributed)

### fees_owed
- **Purpose**: Tracks platform fees accrued
- **Nature**: Liability (seller owes platform)
- **Entry**:
  - DEBIT when fees calculated (seller now owes fees)
  - CREDIT when fees paid out to platform (liability discharged)

### seller_payout
- **Purpose**: Tracks money owed to seller
- **Nature**: Liability (platform owes seller)
- **Entry**:
  - DEBIT when settlement calculated (platform now owes seller)
  - CREDIT when payment made to seller (liability discharged)

### order_pending (deprecated in Prisma 7, included for reference)
- **Purpose**: Tracks orders waiting for payment
- **Nature**: Liability (seller owes goods)
- **Entry**:
  - DEBIT when order created
  - CREDIT when payment received or order cancelled

## Transaction Flow: $100 Order with 3% Fee

### State 1: Order Created

```
Event: OrderCreated
  orderId: ord_123
  amount: $100.00
  idempotencyKey: order_key_001

Ledger entries:
  DEBIT  order_balance     +$100.00
  CREDIT order_pending     +$100.00

Accounts:
  ┌──────────────────────────────────────┐
  │ order_balance (liability)            │
  │ Debits:  $100.00                     │
  │ Credits: $0.00                       │
  │ Balance: +$100.00 (seller owes goods)│
  │                                      │
  │ order_pending (liability)            │
  │ Debits:  $100.00                     │
  │ Credits: $0.00                       │
  │ Balance: +$100.00                    │
  │                                      │
  │ TOTAL LEDGER BALANCE: $0.00 ✅       │
  └──────────────────────────────────────┘
```

### State 2: Payment Confirmed

```
Event: PaymentConfirmed
  orderId: ord_123
  amount: $100.00
  stripeChargeId: ch_123
  idempotencyKey: payment_key_001

Ledger entries:
  DEBIT  payment_received  +$100.00
  CREDIT order_balance     -$100.00

Accounts:
  ┌──────────────────────────────────────┐
  │ order_balance                        │
  │ Debits:  $100.00                     │
  │ Credits: $100.00                     │
  │ Balance: $0.00 ✅                    │
  │                                      │
  │ payment_received (asset)             │
  │ Debits:  $100.00                     │
  │ Credits: $0.00                       │
  │ Balance: +$100.00 (money received)   │
  │                                      │
  │ TOTAL LEDGER BALANCE: $0.00 ✅       │
  └──────────────────────────────────────┘
```

### State 3: Fee Calculated

```
Event: FeeCalculated
  orderId: ord_123
  amount: $3.00 (3% of $100)
  idempotencyKey: fee_key_001

Calculation:
  $100.00 × 0.03 = $3.00 (using Decimal.js)
  $100.00 - $3.00 = $97.00 payout

Ledger entries:
  DEBIT  fees_owed        +$3.00
  CREDIT payment_received -$3.00

Accounts:
  ┌──────────────────────────────────────┐
  │ payment_received                     │
  │ Debits:  $100.00                     │
  │ Credits: $3.00                       │
  │ Balance: +$97.00                     │
  │                                      │
  │ fees_owed (liability)                │
  │ Debits:  $3.00                       │
  │ Credits: $0.00                       │
  │ Balance: +$3.00                      │
  │                                      │
  │ TOTAL LEDGER BALANCE: $0.00 ✅       │
  └──────────────────────────────────────┘
```

### State 4: Settlement Processed

```
Event: SettlementProcessed
  date: 2026-05-24
  orderId: ord_123
  payoutAmount: $97.00
  idempotencyKey: settle_key_2026_05_24

Calculation:
  Payout = payment_received - fees_owed
  Payout = $100.00 - $3.00 = $97.00

Ledger entries:
  DEBIT  seller_payout     +$97.00
  CREDIT payment_received  -$97.00

Accounts:
  ┌──────────────────────────────────────┐
  │ payment_received                     │
  │ Debits:  $100.00                     │
  │ Credits: $3.00 + $97.00 = $100.00   │
  │ Balance: $0.00 ✅                    │
  │                                      │
  │ fees_owed                            │
  │ Debits:  $3.00                       │
  │ Credits: $0.00                       │
  │ Balance: +$3.00 (still owed)         │
  │                                      │
  │ seller_payout                        │
  │ Debits:  $97.00                      │
  │ Credits: $0.00                       │
  │ Balance: +$97.00 (owed to seller)    │
  │                                      │
  │ TOTAL LEDGER BALANCE: $0.00 ✅       │
  └──────────────────────────────────────┘
```

## Ledger Balance Verification

### Query to Verify Order Balance

```sql
SELECT 
  'order_balance' as account,
  SUM(CASE WHEN debit IS NOT NULL THEN debit ELSE 0 END)::NUMERIC(18,4) as total_debits,
  SUM(CASE WHEN credit IS NOT NULL THEN credit ELSE 0 END)::NUMERIC(18,4) as total_credits,
  (SUM(CASE WHEN debit IS NOT NULL THEN debit ELSE 0 END) - 
   SUM(CASE WHEN credit IS NOT NULL THEN credit ELSE 0 END))::NUMERIC(18,4) as balance
FROM "Ledger"
WHERE orderId = 'ord_123'
GROUP BY account

UNION ALL

SELECT 
  account,
  SUM(CASE WHEN debit IS NOT NULL THEN debit ELSE 0 END)::NUMERIC(18,4),
  SUM(CASE WHEN credit IS NOT NULL THEN credit ELSE 0 END)::NUMERIC(18,4),
  (SUM(CASE WHEN debit IS NOT NULL THEN debit ELSE 0 END) - 
   SUM(CASE WHEN credit IS NOT NULL THEN credit ELSE 0 END))::NUMERIC(18,4)
FROM "Ledger"
WHERE orderId = 'ord_123'
GROUP BY account;
```

### Query for Total Ledger Balance

```sql
SELECT 
  (SUM(CASE WHEN debit IS NOT NULL THEN debit ELSE 0 END) - 
   SUM(CASE WHEN credit IS NOT NULL THEN credit ELSE 0 END))::NUMERIC(18,4) as total_balance
FROM "Ledger"
WHERE DATE(timestamp) = CURRENT_DATE;

```

### Imbalance Detection Alert

```typescript
async function checkLedgerHealth() {
  const result = await db.$queryRaw`
    SELECT 
      (SUM(CASE WHEN debit IS NOT NULL THEN debit ELSE 0 END) - 
       SUM(CASE WHEN credit IS NOT NULL THEN credit ELSE 0 END)) as balance
    FROM "Ledger"
    WHERE DATE(timestamp) = CURRENT_DATE;
  `;
  
  const balance = new Decimal(result[0].balance);
  
  if (!balance.equals(0)) {
    console.error(`❌ LEDGER IMBALANCE DETECTED: ${balance}`);
    
    await alertOps({
      severity: 'CRITICAL',
      message: `Ledger imbalance: ${balance}`,
      timestamp: new Date()
    });
    
    process.exit(1);
  }
  
  console.log('✅ Ledger healthy: balance = 0');
}
```

## Fee Calculation Rules

### Rule: 3% Platform Fee

```
fee = amount × 0.03
payout = amount - fee

Examples:
  $100.00 × 0.03 = $3.00 fee, $97.00 payout
  $50.00 × 0.03 = $1.50 fee, $48.50 payout
  $10.00 × 0.03 = $0.30 fee, $9.70 payout
  $0.01 × 0.03 = $0.0003 → rounded to $0.00 fee (or $0.0003?)
```

### Edge Case: Fractional Cents

```typescript
const amount = new Decimal('10.00');
const fee = amount.times('0.03');  // $0.30

const feeRoundUp = amount.times('0.03').toDecimalPlaces(4, Decimal.ROUND_UP);

const fee = amount.times('0.03').toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
```

## Settlement Rules

### Daily Settlement

**Trigger**: End of business day (UTC 00:00)

**Process**:
1. Find all orders with status = 'FEES_CALCULATED' and timestamp < today
2. Sum payout amounts
3. Create settlement event
4. Create ledger entries (payout debits, payment_received credits)
5. Update order status = 'SETTLED'

### Settlement Idempotency

```typescript

const existing = await db.financialEvent.findUnique({
  where: {
    idempotencyKey: `settlement_${date.toISOString().split('T')[0]}`
  }
});

if (existing) {
  return existing;
}

const settlement = await db.financialEvent.create({
  data: {
    eventType: 'SettlementProcessed',
    idempotencyKey: `settlement_${date}`,
    ...
  }
});
```

### Settlement Payout Verification

```typescript
async function verifySettlementAmount(date: Date) {
  const orders = await db.order.findMany({
    where: {
      settledAt: null,
      createdAt: { lt: date }
    }
  });
  
  let expectedPayout = new Decimal(0);
  for (const order of orders) {
    const amount = new Decimal(order.amount);
    const fee = amount.times('0.03').toDecimalPlaces(4);
    const payout = amount.minus(fee);
    expectedPayout = expectedPayout.plus(payout);
  }
  
  const settlement = await db.financialEvent.findFirst({
    where: {
      eventType: 'SettlementProcessed',
      timestamp: {
        gte: date,
        lt: new Date(date.getTime() + 24 * 60 * 60 * 1000)
      }
    }
  });
  
  const actualPayout = new Decimal(settlement.payload.totalPayout);
  
  if (!expectedPayout.equals(actualPayout)) {
    throw new Error(
      `Settlement mismatch: expected ${expectedPayout}, got ${actualPayout}`
    );
  }
  
  return { verified: true, amount: actualPayout };
}
```

## Refund Rules

### Refund Flow

```
Order status: PAYMENT_CONFIRMED
↓
Refund requested
↓
Event: RefundInitiated
↓
Ledger:
  DEBIT  payment_received   -$100.00  (return money)
  CREDIT refunds_pending    +$100.00  (set aside)
↓
Stripe refund API call
↓
Event: RefundConfirmed
↓
Ledger:
  DEBIT  refunds_pending    -$100.00
  CREDIT refunded_customers +$100.00
↓
Order status: REFUNDED
```

### Refund Idempotency

```typescript
async function recordRefund(orderId: string, idempotencyKey: string) {
  const existing = await db.financialEvent.findUnique({
    where: { idempotencyKey }
  });
  
  if (existing) return existing;
  
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (order.status === 'REFUNDED') {
    throw new Error('Already refunded');
  }
  
}
```

## Compliance & Audit

### Audit Trail Requirements

Every financial event must record:

```typescript
interface FinancialEvent {
  id: string;                    
  aggregateId: string;           
  eventType: string;             
  payload: Record<string, any>;  
  version: number;               
  timestamp: Date;               
  idempotencyKey: string;        
  userId?: string;               
}
```

### Compliance Queries

```sql
SELECT * FROM "EventLog"
WHERE aggregateId IN (
  SELECT id FROM "Order" WHERE customerId = 'cust_123'
)
ORDER BY timestamp DESC;

SELECT * FROM "EventLog"
WHERE timestamp BETWEEN '2026-05-24' AND '2026-05-25'
ORDER BY timestamp DESC;

SELECT * FROM "EventLog"
WHERE eventType IN ('PaymentConfirmed', 'RefundConfirmed', 'PaymentFailed')
ORDER BY timestamp DESC;
```

### Chargeback Handling

```typescript
async function recordChargeback(orderId: string, amount: Decimal, chargebackId: string) {
  await db.financialEvent.create({
    data: {
      aggregateId: orderId,
      eventType: 'ChargebackInitiated',
      payload: { amount: amount.toString(), chargebackId },
      idempotencyKey: chargebackId  
    }
  });
  
  await db.ledger.createMany({
    data: [
      { orderId, account: 'payment_received', credit: amount },
      { orderId, account: 'chargebacks_pending', debit: amount }
    ]
  });
  
  await db.order.update({
    where: { id: orderId },
    data: {
      status: 'CHARGEBACK',
      chargebackId
    }
  });
}
```

## Testing Financial Precision

```typescript
describe('Financial Precision', () => {
  it('should calculate 3% fee without rounding errors', () => {
    const tests = [
      { amount: '100.00', expectedFee: '3.00', expectedPayout: '97.00' },
      { amount: '50.00', expectedFee: '1.50', expectedPayout: '48.50' },
      { amount: '10.00', expectedFee: '0.30', expectedPayout: '9.70' },
      { amount: '999999.99', expectedFee: '29999.9997', expectedPayout: '969999.9903' },
      { amount: '0.01', expectedFee: '0.0003', expectedPayout: '0.0097' },
    ];
    
    for (const test of tests) {
      const amount = new Decimal(test.amount);
      const fee = amount.times('0.03').toDecimalPlaces(4);
      const payout = amount.minus(fee);
      
      expect(fee.toString()).toBe(test.expectedFee);
      expect(payout.toString()).toBe(test.expectedPayout);
      
      expect(fee.plus(payout).toString()).toBe(test.amount);
    }
  });
});
```

---

**Financial Rules: Precision always. Exceptions never.**
