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

// ==========================================
// RUTE 1: POST /orders (Membuat Pesanan)
// ==========================================
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

// ==========================================
// RUTE 2: POST /orders/:id/pay (Membayar Pesanan)
// ==========================================
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

// ==========================================
// RUTE 3: GET /orders/:id (Melihat Status Pesanan)
// ==========================================
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

// ==========================================
// RUTE 4: GET /orders/:id/ledger (Melihat Audit Buku Besar)
// ==========================================
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

// ==========================================
// RUTE 5: GET /verify-ledger/:id (Memverifikasi Keseimbangan)
// ==========================================
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

// ==========================================
// RUTE 6: POST /settle (Pencairan Dana Harian)
// ==========================================
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


// ==========================================
// RUTE 7: GET /orders (Mengambil Daftar Pesanan dari EventLog)
// ==========================================
fastify.get('/orders', async (request, reply) => {
  try {
    // Mencari 20 pesanan terakhir yang pernah dibuat
    const orderEvents = await prisma.eventLog.findMany({
      where: { eventType: 'OrderCreated' },
      orderBy: { timestamp: 'desc' },
      take: 20
    });

    // Mengubah format data agar sesuai dengan tabel di Frontend
    const orders = orderEvents.map((event) => ({
      id: event.aggregateId,
      // Default ke 0, status lunas akan dicek akurat saat pesanan diklik
      payment_received: 0 
    }));

    return reply.status(200).send({ success: true, orders });
  } catch (error: any) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

start();