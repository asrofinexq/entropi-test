# Architecture Document

## System Overview

Entropi implements **event sourcing** with a **double-entry ledger** to solve the fundamental problem of financial systems: every dollar must be accounted for, immutable, and auditable.

```
REQUEST
   ↓
VALIDATION
   ↓
EVENT EMISSION (immutable)
   ↓
LEDGER ENTRY (balanced)
   ↓
READ MODEL UPDATE (eventual consistency)
   ↓
RESPONSE
```

## Design Decisions & Trade-offs

### 1. Why Event Sourcing?

**Problem**: Traditional order systems store only current state. If something fails mid-payment, you don't know what happened.

**Solution**: Store every financial event in append-only log. Ledger state is derived from replaying events.

**Benefits**:
- ✅ Full audit trail: know exactly what happened and when
- ✅ Replay capability: rebuild state by replaying events from any point
- ✅ Idempotency: same event applied twice = same result (because events are immutable)
- ✅ Debugging: transaction failed? Replay and see where it broke

**Trade-off**: Event log grows unbounded. Mitigation: implement event archival after 90 days.

### 2. Why Double-Entry Ledger?

**Problem**: Financial mistakes are invisible. Account balance went down? Where did the money go?

**Solution**: Every transaction has two sides (debit + credit). Total debits must always equal total credits.

**Benefits**:
- ✅ Instant fraud detection: imbalanced ledger = data corruption
- ✅ Reconciliation: compare ledger to external systems (Stripe, bank)
- ✅ Legal compliance: ledger is trial balance—audit-ready

**Math guarantee**:
```
For any order:
  SUM(debits) - SUM(credits) MUST = 0

If not:
  ALERT: Ledger corruption detected. Investigate immediately.
```

**Example**: $100 order, 3% fee

```
Order Balance Account:
  DEBIT  +100  (order received)
  CREDIT -100  (payment confirmed)
  Balance = 0 ✅

Payment Received Account:
  DEBIT  +100  (money in)
  CREDIT -3    (fee taken)
  CREDIT -97   (payout to seller)
  Balance = 0 ✅

Total Ledger: 300 debits, 300 credits ✅
```

### 3. Why Decimal(18,4)?

**Problem**: JavaScript's `Number` type uses IEEE 754 floating-point. `0.1 + 0.2 !== 0.3`.

```javascript
0.1 + 0.2 = 0.30000000000000004  //  Financial disaster
```

**Solution**: Use `Decimal(18,4)` in PostgreSQL + `Decimal.js` in Node.

- 18 digits total (max: $9,999,999,999,999.9999)
- 4 decimal places (cents precision: $0.0001)
- Stored as integer in database (100000000 = $10,000.0000)

**Verification**:
```
10 × $0.03 = $0.30 (not $0.30000000000000004) ✅
$999,999.99 + $0.01 = $1,000,000.00 ✅
$0.01 ÷ 3 = $0.0033 (banker's rounding) ✅
```

### 4. Why Separate EventLog Table?

**Problem**: If we store ledger entries and events in same table, we lose the causal chain.

**Solution**: Two tables:
- **EventLog**: immutable events (append-only)
- **Ledger**: derived from events (rebuild anytime)

**Advantage**: If ledger is corrupted, replay events to fix it.

```
EventLog (source of truth):
  - OrderCreated(id=1, amount=100)
  - PaymentConfirmed(id=1, chargeId=stripe_123)
  - FeeCalculated(id=1, amount=3)
  - SettlementProcessed(date=2026-05-24)

Ledger (derived):
  - Run event replay
  - Generate fresh ledger
  - Verify balance = 0
```

### 5. Why idempotencyKey?

**Problem**: Network timeouts. Client doesn't know if request succeeded. Retries duplicate charge.

```
Customer clicks "Pay" → Network timeout → ???
Customer clicks "Pay" again → Duplicate charge 💀
```

**Solution**: Every financial mutation includes `idempotencyKey` (UUID).

- First call: `idempotencyKey = "pay_abc123"` → creates event
- Retry: same `idempotencyKey` → returns existing result (no duplicate)
- Unique constraint: `UNIQUE(idempotencyKey)` prevents duplicates at DB level

**Implementation**:

```typescript
// Check if already processed
const existing = await db.financialEvent.findUnique({
  where: { idempotencyKey }
});

if (existing) return existing;  // Duplicate: return cached result

// New request: process and insert
const event = await db.financialEvent.create({
  data: { ..., idempotencyKey }
});

return event;
```

### 6. Why version Field?

**Problem**: Concurrent payments. Two requests hit at same time. Which version is current?

**Solution**: Optimistic locking with version numbers.

- Each aggregate (order) has version counter
- Event includes version: `version: 1, 2, 3...`
- Constraint: `UNIQUE(aggregateId, version)` prevents duplicates

**Conflict detection**:

```typescript
// Check current version
const order = await db.order.findUnique({ where: { id: orderId } });
const currentVersion = order.version;

// Try to insert event with next version
const event = await db.financialEvent.create({
  data: {
    aggregateId: orderId,
    version: currentVersion + 1,  // Next version
    ...
  }
});

// If version already exists: conflict error
// Retry logic handles it
```

## Data Model

### EventLog Table

```prisma
model EventLog {
  id              String    @id @default(uuid())
  aggregateId     String    // FK to Order
  eventType       String    // "OrderCreated", "PaymentConfirmed", etc.
  payload         Json      // Event data (amount, chargeId, etc.)
  version         Int       // Monotonic version for aggregate
  timestamp       DateTime  @default(now())
  idempotencyKey  String    @unique  // Deduplication
  
  @@unique([aggregateId, version])  // Only one event per version
  @@index([aggregateId, version])
  @@index([eventType])
  @@index([timestamp])
}
```

### Ledger Table

```prisma
model Ledger {
  id          String    @id @default(uuid())
  orderId     String    // FK to Order
  account     String    // "order_balance", "payment_received", etc.
  debit       Decimal   @db.Decimal(18, 4)  // Money in (nullable)
  credit      Decimal   @db.Decimal(18, 4)  // Money out (nullable)
  timestamp   DateTime  @default(now())
  eventType   String    // Reference to triggering event
  
  @@check("(debit IS NOT NULL AND credit IS NULL) OR (debit IS NULL AND credit IS NOT NULL)")
  @@index([orderId])
  @@index([account])
  @@index([timestamp])
}
```

**Invariant**: Exactly ONE of `debit` or `credit` is non-null.

```sql
-- Verify invariant
SELECT * FROM "Ledger"
WHERE NOT (
  (debit IS NOT NULL AND credit IS NULL) OR 
  (debit IS NULL AND credit IS NOT NULL)
);
-- Should return 0 rows
```

## State Machine

Every order transitions through defined states:

```
PENDING_PAYMENT
    ↓
    ├─→ PAYMENT_FAILED → (retry)
    ↓
PAYMENT_PROCESSING
    ↓
    ├─→ PAYMENT_DECLINED → (refund)
    ↓
PAYMENT_CONFIRMED
    ↓
FEES_CALCULATED
    ↓
READY_FOR_SETTLEMENT
    ↓
SETTLED
    ↓
SHIPPED
    ↓
DELIVERED
```

### Transition Validation

```typescript
const validTransitions = {
  PENDING_PAYMENT: ["PAYMENT_PROCESSING"],
  PAYMENT_PROCESSING: ["PAYMENT_CONFIRMED", "PAYMENT_FAILED", "PAYMENT_DECLINED"],
  PAYMENT_CONFIRMED: ["FEES_CALCULATED"],
  FEES_CALCULATED: ["READY_FOR_SETTLEMENT"],
  READY_FOR_SETTLEMENT: ["SETTLED"],
  SETTLED: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
};

function validateTransition(fromState, toState) {
  if (!validTransitions[fromState].includes(toState)) {
    throw new Error(`Invalid transition: ${fromState} → ${toState}`);
  }
}
```

## Read Model Projections

Events are immutable, but queries need fast access. **Read models** are derived from events.

### Order Projection

```typescript
interface OrderProjection {
  orderId: string;
  customerId: string;
  amount: Decimal;
  status: string;
  paymentReceivedAmount: Decimal;
  feesOwedAmount: Decimal;
  payoutAmount: Decimal;
  stripeChargeId: string;
  settledAt: DateTime | null;
  updatedAt: DateTime;
}
```

### How Projections Update

1. Event is written to EventLog
2. Projection listener picks up new event
3. Updates read model (Order table)
4. Frontend queries Order table (fast)

**Flow**:
```
recordPayment() 
  → EventLog.insert(PaymentConfirmed)
  → (async) listener.on('PaymentConfirmed')
  → Order.update({amount_received: ...})
  → Query returns fresh data
```

## API Request Flow

### POST /orders/:id/pay

```typescript
async function recordPayment(
  orderId: string,
  amount: Decimal,
  idempotencyKey: string
) {
  // 1. IDEMPOTENCY CHECK
  const existing = await db.financialEvent.findUnique({
    where: { idempotencyKey }
  });
  if (existing) return existing;  // Already processed
  
  // 2. ORDER VALIDATION
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('Order not found');
  if (order.status !== 'PAYMENT_PROCESSING') {
    throw new Error('Order not ready for payment');
  }
  
  // 3. STATE TRANSITION
  validateTransition(order.status, 'PAYMENT_CONFIRMED');
  
  // 4. STRIPE CHARGE (mocked)
  const charge = await stripeAPI.charge({
    amount: amount.toJSON(),
    customerId: order.customerId
  });
  
  // 5. ATOMIC: Create event + ledger entries
  const result = await db.$transaction(async (tx) => {
    // Create event
    const event = await tx.financialEvent.create({
      data: {
        aggregateId: orderId,
        eventType: 'PaymentConfirmed',
        payload: {
          amount: amount.toString(),
          stripeChargeId: charge.id
        },
        version: order.version + 1,
        idempotencyKey
      }
    });
    
    // Create ledger entries (maintain balance)
    await tx.ledger.createMany({
      data: [
        {
          orderId,
          account: 'payment_received',
          debit: amount,
          eventType: 'PaymentConfirmed'
        },
        {
          orderId,
          account: 'order_balance',
          credit: amount,
          eventType: 'PaymentConfirmed'
        }
      ]
    });
    
    // Update projection
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'PAYMENT_CONFIRMED',
        paymentReceivedAmount: order.paymentReceivedAmount.plus(amount),
        stripeChargeId: charge.id,
        version: order.version + 1
      }
    });
    
    return event;
  });
  
  return result;
}
```

**Why this order?**
1. Check idempotency first (fast fail on duplicates)
2. Validate state before external calls
3. Call external API (Stripe)
4. Atomic DB transaction (all-or-nothing)
5. No ledger entry until event is committed

## Error Handling

### Idempotency Error (Good)

```
Request 1: Pay $100 → Success → Event created
Request 2: Pay $100 (retry) → Returns Request 1's event → No duplicate
```

### Version Conflict (Concurrency Control)

```
Order version = 5
Request A: Create event version 6 ✅
Request B: Create event version 6 ✗ (UNIQUE constraint)
  → Retry with version 7
```

### Ledger Imbalance (Data Corruption Alert)

```typescript
async function verifyLedger(orderId: string) {
  const ledger = await db.ledger.findMany({
    where: { orderId }
  });
  
  const sumDebits = ledger
    .filter(e => e.debit)
    .reduce((sum, e) => sum.plus(e.debit), new Decimal(0));
  
  const sumCredits = ledger
    .filter(e => e.credit)
    .reduce((sum, e) => sum.plus(e.credit), new Decimal(0));
  
  const balance = sumDebits.minus(sumCredits);
  
  if (!balance.equals(0)) {
    throw new Error(`Ledger imbalance: ${balance} (CRITICAL!)`);
  }
  
  return { isBalanced: true };
}
```

## Testing Strategy

### Unit Tests

- Event creation (happy path)
- Idempotency (duplicate requests)
- State transitions (invalid moves)
- Ledger balance (always zero)
- Decimal precision (edge cases)

### Integration Tests

- End-to-end order flow
- Concurrent payments
- Settlement calculation
- Projection consistency

### Load Tests

- 1,000 concurrent orders
- Measure: throughput, latency, ledger integrity
- Verify: no duplicates, all recorded, balanced

## Performance Considerations

### Indexes

```sql
-- EventLog indexes
CREATE INDEX idx_eventlog_aggregate ON "EventLog"(aggregateId, version);
CREATE INDEX idx_eventlog_type ON "EventLog"(eventType);
CREATE INDEX idx_eventlog_timestamp ON "EventLog"(timestamp);

-- Ledger indexes
CREATE INDEX idx_ledger_order ON "Ledger"(orderId);
CREATE INDEX idx_ledger_account ON "Ledger"(account);
CREATE INDEX idx_ledger_timestamp ON "Ledger"(timestamp);
```

### Query Patterns

```typescript
// Fast: replay events for single order
SELECT * FROM "EventLog"
WHERE aggregateId = $1
ORDER BY version;

// Fast: ledger balance for order
SELECT 
  account,
  SUM(CASE WHEN debit IS NOT NULL THEN debit ELSE 0 END) as total_debits,
  SUM(CASE WHEN credit IS NOT NULL THEN credit ELSE 0 END) as total_credits
FROM "Ledger"
WHERE orderId = $1
GROUP BY account;

// Slow: avoid full table scans
SELECT * FROM "Ledger"  -- ❌ No index on this
WHERE timestamp > now() - INTERVAL '1 day';
-- Use: CREATE INDEX idx_ledger_timestamp ON "Ledger"(timestamp);
```

## Scaling Strategy

### Horizontal Scaling

```
Load Balancer
  ↓
  ├─ API Instance 1
  ├─ API Instance 2
  └─ API Instance 3
  
All hit same PostgreSQL (no data loss)
Idempotency keys prevent duplicates
```

### Database Sharding

If ledger grows >100GB:
- Shard by `orderId % 16`
- Each shard: separate PostgreSQL
- Router: choose shard by order ID

### Archival

After 90 days:
- Move old events to cold storage (S3)
- Keep recent events in hot DB
- Rebuild projections from archive if needed

---

**Architecture: Simple, reliable, auditable.**
