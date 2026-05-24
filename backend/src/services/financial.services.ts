import prisma from '../utils/db.js';
import { Prisma } from '@prisma/client'; 


export async function recordOrder(orderId: string, amount: string, idempotencyKey: string) {
  const decimalAmount = new Prisma.Decimal(amount);

  return await prisma.$transaction(async (tx) => {
    const existingEvent = await tx.eventLog.findUnique({
      where: { idempotencyKey }
    });
    if (existingEvent) return existingEvent;

    const event = await tx.eventLog.create({
      data: {
        aggregateId: orderId,
        eventType: 'OrderCreated',
        payload: { amount: decimalAmount.toString() },
        version: 1, 
        idempotencyKey: idempotencyKey,
      }
    });

    await tx.ledger.create({
      data: { orderId, account: 'order_balance', debit: decimalAmount, credit: null }
    });

    await tx.ledger.create({
      data: { orderId, account: 'order_pending', debit: null, credit: decimalAmount }
    });

    return event;
  });
}


export async function recordPayment(orderId: string, amount: string, stripeId: string, idempotencyKey: string) {
  const decimalAmount = new Prisma.Decimal(amount);

  return await prisma.$transaction(async (tx) => {
    const existingEvent = await tx.eventLog.findUnique({
      where: { idempotencyKey }
    });
    if (existingEvent) return existingEvent;

    const lastEvent = await tx.eventLog.findFirst({
      where: { aggregateId: orderId },
      orderBy: { version: 'desc' }
    });

    if (!lastEvent) throw new Error('Pesanan tidak ditemukan');


    const alreadyPaid = await tx.eventLog.findFirst({
      where: { aggregateId: orderId, eventType: 'PaymentConfirmed' }
    });
    
    if (alreadyPaid) {
      throw new Error('StateConflict: Pesanan ini sudah berhasil dibayar sebelumnya');
    }

    const event = await tx.eventLog.create({
      data: {
        aggregateId: orderId,
        eventType: 'PaymentConfirmed',
        payload: { amount: decimalAmount.toString(), chargeId: stripeId },
        version: lastEvent.version + 1, 
        idempotencyKey: idempotencyKey,
      }
    });

    await tx.ledger.create({
      data: { orderId, account: 'payment_received', debit: decimalAmount, credit: null }
    });

    await tx.ledger.create({
      data: { orderId, account: 'order_balance', debit: null, credit: decimalAmount }
    });

    return event;
  });
}


export async function calculateFees(orderId: string, amount: string, idempotencyKey: string) {
  const decimalAmount = new Prisma.Decimal(amount);
  
  const feeAmount = decimalAmount.mul(new Prisma.Decimal('0.03'));

  return await prisma.$transaction(async (tx) => {
    const existingEvent = await tx.eventLog.findUnique({
      where: { idempotencyKey }
    });
    if (existingEvent) return existingEvent;

    const lastEvent = await tx.eventLog.findFirst({
      where: { aggregateId: orderId },
      orderBy: { version: 'desc' }
    });

    if (!lastEvent) throw new Error('Pesanan tidak ditemukan');

    const event = await tx.eventLog.create({
      data: {
        aggregateId: orderId,
        eventType: 'FeeCalculated',
        payload: { feeAmount: feeAmount.toString() },
        version: lastEvent.version + 1,
        idempotencyKey: idempotencyKey,
      }
    });

    await tx.ledger.create({
      data: { orderId, account: 'fees_owed', debit: feeAmount, credit: null }
    });

    await tx.ledger.create({
      data: { orderId, account: 'payment_received', debit: null, credit: feeAmount }
    });

    return event;
  });
}

export async function verifyLedgerBalance(orderId: string) {
  const ledgers = await prisma.ledger.findMany({
    where: { orderId }
  });

  let totalDebit = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);

  for (const entry of ledgers) {
    if (entry.debit) totalDebit = totalDebit.plus(entry.debit);
    if (entry.credit) totalCredit = totalCredit.plus(entry.credit);
  }

  const balance = totalDebit.minus(totalCredit);
  
  const isBalanced = balance.equals(new Prisma.Decimal(0));

  return {
    orderId,
    totalDebit: totalDebit.toString(),
    totalCredit: totalCredit.toString(),
    balance: balance.toString(),
    isBalanced 
  };
}

export async function dailySettlement(date: string, idempotencyKey: string) {
  return await prisma.$transaction(async (tx) => {
    const existingEvent = await tx.eventLog.findUnique({
      where: { idempotencyKey }
    });
    if (existingEvent) return existingEvent;

    const ledgers = await tx.ledger.findMany({
      where: { account: 'payment_received' }
    });

    let balance = new Prisma.Decimal(0);
    for (const entry of ledgers) {
      if (entry.debit) balance = balance.plus(entry.debit);
      if (entry.credit) balance = balance.minus(entry.credit);
    }

    if (balance.lessThanOrEqualTo(0)) {
      throw new Error('Tidak ada saldo untuk dicairkan');
    }

    const event = await tx.eventLog.create({
      data: {
        aggregateId: `settlement-${date}`,
        eventType: 'SettlementProcessed',
        payload: { date, amount: balance.toString() },
        version: 1,
        idempotencyKey: idempotencyKey,
      }
    });

    await tx.ledger.create({
      data: { orderId: `settlement-${date}`, account: 'seller_payout', debit: balance, credit: null }
    });

    await tx.ledger.create({
      data: { orderId: `settlement-${date}`, account: 'payment_received', debit: null, credit: balance }
    });

    return event;
  });
}