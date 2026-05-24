import Fastify from 'fastify';
import cors from '@fastify/cors';
import { 
  recordOrder, 
  recordPayment, 
  calculateFees, 
  verifyLedgerBalance,
  dailySettlement 
} from './services/financial.services.js';
import { processPayment } from './services/stripe.service.js';
import prisma from './utils/db.js';

const fastify = Fastify({
  logger: true 
});

fastify.register(cors, {
  origin: '*'
});


fastify.post('/orders', async (request, reply) => {
  const { orderId, amount, idempotencyKey } = request.body as {
    orderId: string;
    amount: string; 
    idempotencyKey: string;
  };

  if (!orderId || !amount || !idempotencyKey) {
    return reply.status(400).send({ error: 'orderId, amount, dan idempotencyKey wajib diisi' });
  }

  try {
    const result = await recordOrder(orderId, amount, idempotencyKey);
    return reply.status(201).send(result);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return reply.status(409).send({ error: 'Conflict: Permintaan ganda terdeteksi' });
    }
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});


fastify.post('/orders/:id/pay', async (request, reply) => {
  const { id: orderId } = request.params as { id: string };
  const { amount, customerId, idempotencyKey } = request.body as {
    amount: string;
    customerId: string;
    idempotencyKey: string;
  };

  if (!amount || !customerId || !idempotencyKey) {
    return reply.status(400).send({ error: 'amount, customerId, dan idempotencyKey wajib diisi' });
  }

  try {
    const stripeResponse = await processPayment(orderId, amount, customerId);
    const paymentEvent = await recordPayment(orderId, amount, stripeResponse.chargeId, idempotencyKey);
    const feeEvent = await calculateFees(orderId, amount, `fee-${idempotencyKey}`);

    return reply.status(200).send({ paymentEvent, feeEvent });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return reply.status(409).send({ error: 'Conflict: VersionConflict atau idempotency ganda terdeteksi' });
    }
    fastify.log.error(error);
    return reply.status(500).send({ error: error.message || 'Internal Server Error' });
  }
});


fastify.get('/orders/:id', async (request, reply) => {
  const { id: orderId } = request.params as { id: string };
  try {
    const events = await prisma.eventLog.findMany({
      where: { aggregateId: orderId },
      orderBy: { version: 'asc' }
    });
    return reply.status(200).send(events);
  } catch (error: any) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});


fastify.get('/orders/:id/ledger', async (request, reply) => {
  const { id: orderId } = request.params as { id: string };
  try {
    const ledgers = await prisma.ledger.findMany({
      where: { orderId },
      orderBy: { timestamp: 'asc' }
    });
    return reply.status(200).send(ledgers);
  } catch (error: any) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});


fastify.get('/verify-ledger/:id', async (request, reply) => {
  const { id: orderId } = request.params as { id: string };
  try {
    const verification = await verifyLedgerBalance(orderId);
    return reply.status(200).send(verification);
  } catch (error: any) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});


fastify.post('/settle', async (request, reply) => {
  const { date, idempotencyKey } = request.body as { date: string; idempotencyKey: string; };

  if (!date || !idempotencyKey) {
    return reply.status(400).send({ error: 'date dan idempotencyKey wajib diisi' });
  }

  try {
    const result = await dailySettlement(date, idempotencyKey);
    return reply.status(200).send(result);
  } catch (error: any) {
    if (error.code === 'P2002') return reply.status(409).send({ error: 'Conflict: Settlement ganda terdeteksi' });
    fastify.log.error(error);
    return reply.status(500).send({ error: error.message || 'Internal Server Error' });
  }
});


fastify.get('/orders', async (request, reply) => {
  try {
    const orderEvents = await prisma.eventLog.findMany({
      where: { eventType: 'OrderCreated' },
      orderBy: { timestamp: 'desc' },
      take: 20
    });

    const orderIds = orderEvents.map(e => e.aggregateId);

    const paymentEvents = await prisma.eventLog.findMany({
      where: {
        aggregateId: { in: orderIds },
        eventType: 'PaymentConfirmed'
      }
    });

    const paidOrderIds = new Set(paymentEvents.map(e => e.aggregateId));

    const orders = orderEvents.map((event) => ({
      id: event.aggregateId,
      payment_received: paidOrderIds.has(event.aggregateId) ? 1 : 0 
    }));

    return reply.status(200).send({ success: true, orders });
  } catch (error: any) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 8080;
    await fastify.listen({ port: port, host: '0.0.0.0' });
    console.log(`Server Backend berjalan di port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();