# Entropi Financial System

**A production-grade financial order processing system for e-commerce sellers with event sourcing, double-entry ledger, and concurrent payment processing.**

## Overview

Entropi processes high-volume orders (~1,000/day) with financial precision. Every transaction is immutable, idempotent, and fully auditable. The system guarantees:

- ✅ **Immutability**: All financial events recorded in append-only event log
- ✅ **Precision**: Decimal(18,4) arithmetic—no rounding errors ever
- ✅ **Concurrency**: 1,000 concurrent orders processed safely
- ✅ **Idempotency**: Duplicate requests return identical results
- ✅ **Ledger Balance**: Double-entry bookkeeping—debits always equal credits
- ✅ **Audit Trail**: Full compliance-ready transaction history

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│          Next.js Frontend (Vercel)              │
│    Order Dashboard | Ledger Audit Trail         │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│         Fastify Backend (Railway/Render)        │
│  • Financial Event Service                      │
│  • Payment Processor (Stripe Mock)              │
│  • Settlement Engine                           │
│  • Read Model Projections                       │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│      PostgreSQL + Prisma (Supabase)             │
│  • EventLog (append-only)                       │
│  • Ledger (double-entry)                        │
│  • Orders (read model)                          │
│  • Projections (cache layer)                    │
└─────────────────────────────────────────────────┘
```

## Technology Stack

| Layer       | Technology               |
|-------------|--------------------------|
| **Frontend** | Next.js 14, React, TypeScript strict, Tailwind CSS |
| **Backend** | Fastify, TypeScript strict, Decimal.js |
| **Database** | PostgreSQL, Prisma ORM, Supabase |
| **Testing** | Jest, supertest |
| **Deployment** | Vercel (frontend), Railway/Render (backend), Supabase (database) |

## Financial Model

### Event Types

Every financial action is recorded as an immutable event:

| Event | Trigger | Effect on Ledger |
|-------|---------|-----------------|
| `OrderCreated` | New order received | DEBIT order_balance, CREDIT order_pending |
| `PaymentProcessing` | Payment initiated | (internal state tracking) |
| `PaymentConfirmed` | Stripe confirms charge | DEBIT payment_received, CREDIT order_balance |
| `FeeCalculated` | Fee accrual (3%) | DEBIT fees_owed, CREDIT payment_received |
| `SettlementProcessed` | Daily settlement run | DEBIT seller_payout, CREDIT payment_received |
| `OrderShipped` | Order dispatched | (audit trail only) |
| `OrderDelivered` | Order delivered | (audit trail only) |

### Double-Entry Ledger

Every debit has a corresponding credit. All accounts must balance to zero.

```
Accounts:
  • order_balance: Current order amount (liability)
  • payment_received: Money confirmed from customer
  • fees_owed: Platform fees accrued
  • seller_payout: Money owed to seller
  • order_pending: Orders awaiting payment confirmation
```

Example: $100 order with 3% fee

```
OrderCreated:
  DEBIT  order_balance      +$100.00
  CREDIT order_pending      +$100.00
  Balance: 0

PaymentConfirmed:
  DEBIT  payment_received   +$100.00
  CREDIT order_balance      -$100.00
  Balance: 0

FeeCalculated:
  DEBIT  fees_owed          +$3.00
  CREDIT payment_received   -$3.00
  Balance: 0

SettlementProcessed:
  DEBIT  seller_payout      +$97.00
  CREDIT payment_received   -$97.00
  Balance: 0
```

## Setup & Installation

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or Supabase)
- pnpm (or npm)

### Backend Setup

```bash
cd backend

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# Initialize database
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate

# Run development server
pnpm dev
```

### Frontend Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with backend API URL

# Run development server
pnpm dev
```

### Running Tests

```bash
cd backend
pnpm test
```

## API Endpoints

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/orders` | Create new order |
| GET | `/orders/:id` | Get order status |
| GET | `/orders` | List all orders (paginated) |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/orders/:id/pay` | Process payment for order |
| GET | `/orders/:id/payment-status` | Check payment status |

### Ledger & Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orders/:id/ledger` | Full ledger for order |
| GET | `/orders/:id/verify` | Verify ledger balance |
| GET | `/ledger/accounts` | All account balances |

### Settlement

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/settle` | Process daily settlement |
| GET | `/settle/status/:date` | Get settlement status |

## Request/Response Examples

### Create Order

```bash
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_123",
    "amount": "100.00",
    "idempotencyKey": "order-unique-key-001"
  }'
```

Response:
```json
{
  "orderId": "ord_abc123",
  "status": "pending_payment",
  "amount": "100.00",
  "createdAt": "2026-05-24T10:30:00Z"
}
```

### Process Payment

```bash
curl -X POST http://localhost:3001/orders/ord_abc123/pay \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "100.00",
    "paymentMethod": "card",
    "idempotencyKey": "payment-unique-key-001"
  }'
```

### View Ledger

```bash
curl http://localhost:3001/orders/ord_abc123/ledger
```

Response:
```json
{
  "orderId": "ord_abc123",
  "transactions": [
    {
      "id": "ent_1",
      "account": "order_balance",
      "type": "debit",
      "amount": "100.00",
      "eventType": "OrderCreated",
      "timestamp": "2026-05-24T10:30:00Z"
    },
    {
      "id": "ent_2",
      "account": "order_balance",
      "type": "credit",
      "amount": "100.00",
      "eventType": "PaymentConfirmed",
      "timestamp": "2026-05-24T10:31:00Z"
    },
    {
      "id": "ent_3",
      "account": "fees_owed",
      "type": "debit",
      "amount": "3.00",
      "eventType": "FeeCalculated",
      "timestamp": "2026-05-24T10:31:15Z"
    }
  ],
  "balance": "0.00",
  "isBalanced": true
}
```

## Deployment

### Frontend (Vercel)

```bash
# Deploy Next.js app
vercel deploy --prod
```

### Backend (Railway/Render)

```bash
# Push to Git
git push origin main

# Railway/Render auto-deploys on push
# Or deploy manually via web dashboard
```

## Testing & Verification

### Unit Tests

```bash
pnpm test
```

### Load Test (1,000 concurrent orders)

```bash
pnpm test:load
```

Verifies:
- ✅ All orders recorded without loss
- ✅ No duplicate charges
- ✅ Ledger balanced to zero
- ✅ Payout calculations correct

### Manual Verification

```bash
# Verify ledger balance for specific order
curl http://localhost:3001/orders/ord_abc123/verify

# Check all account balances
curl http://localhost:3001/ledger/accounts
```

## Documentation

For detailed architecture and design decisions, see:

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System design, event sourcing, why this approach
- **[docs/CONCURRENCY.md](docs/CONCURRENCY.md)** — Concurrency strategy, idempotency, race condition prevention
- **[docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md)** — Financial precision, ledger rules, calculations

## Submission Details

- **Evaluation Code**: Ent-JFE-20/05/26
- **Duration**: 8 hours (2 calendar days)
- **Submission Date**: May 24, 2026

## Support

For questions or issues:
1. Check the documentation in `docs/`
2. Review test cases in `backend/__tests__/`
3. Open an issue on GitHub

---

**Built with precision. Audited by design. Ready for scale.**
