import prisma from '../utils/db.js';
import { Prisma } from '@prisma/client';

// ==========================================
// CUSTOM ERROR TYPES
// Dipisah agar handler API bisa membedakan jenis error
// dan mengembalikan HTTP status code yang tepat (409, 404, dst)
// ==========================================
export class StateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateConflictError';
  }
}

export class VersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Pesanan tidak ditemukan: ${orderId}`);
    this.name = 'OrderNotFoundError';
  }
}

// ==========================================
// 1. FUNGSI PENCATATAN PESANAN BARU
// ==========================================
export async function recordOrder(
  orderId: string,
  amount: string,
  idempotencyKey: string,
) {
  const decimalAmount = new Prisma.Decimal(amount);

  return await prisma.$transaction(async (tx) => {
    // IDEMPOTENCY: request identik (key sama) → kembalikan event lama
    const existingEvent = await tx.eventLog.findUnique({
      where: { idempotencyKey },
    });
    if (existingEvent) return existingEvent;

    // BUG #1 DIPERBAIKI: State machine — cegah OrderCreated ganda
    // Kode asli tidak mengecek apakah orderId sudah pernah dibuat.
    // Jika dua request berbeda datang bersamaan dengan orderId yang sama
    // tapi idempotencyKey berbeda, keduanya bisa lolos dan membuat
    // dua EventLog 'OrderCreated' untuk satu pesanan yang sama.
    // Fix: cek eksplisit sebelum insert.
    const orderAlreadyExists = await tx.eventLog.findFirst({
      where: { aggregateId: orderId, eventType: 'OrderCreated' },
    });
    if (orderAlreadyExists) {
      throw new StateConflictError(
        `Pesanan ${orderId} sudah pernah dibuat dengan key berbeda`,
      );
    }

    // BUG #2 DIPERBAIKI: Simpan amount dengan presisi tetap (toFixed(4))
    // Kode asli: payload: { amount: decimalAmount.toString() }
    // toString() bisa menghasilkan notasi seperti "1e+6" atau presisi
    // tidak konsisten. toFixed(4) memastikan format "1000000.0000".
    const event = await tx.eventLog.create({
      data: {
        aggregateId: orderId,
        eventType: 'OrderCreated',
        payload: { amount: decimalAmount.toFixed(4) },
        version: 1,
        idempotencyKey,
      },
    });

    // Double-entry: DEBIT order_balance, CREDIT order_pending
    await tx.ledger.create({
      data: { orderId, account: 'order_balance', debit: decimalAmount, credit: null },
    });
    await tx.ledger.create({
      data: { orderId, account: 'order_pending', debit: null, credit: decimalAmount },
    });

    return event;
  });
}

// ==========================================
// 2. FUNGSI PENCATATAN PEMBAYARAN
// ==========================================
export async function recordPayment(
  orderId: string,
  amount: string,
  stripeId: string,
  idempotencyKey: string,
) {
  const decimalAmount = new Prisma.Decimal(amount);

  return await prisma.$transaction(async (tx) => {
    // IDEMPOTENCY: request identik → kembalikan event lama
    const existingEvent = await tx.eventLog.findUnique({
      where: { idempotencyKey },
    });
    if (existingEvent) return existingEvent;

    // Cari versi terakhir pesanan
    const lastEvent = await tx.eventLog.findFirst({
      where: { aggregateId: orderId },
      orderBy: { version: 'desc' },
    });
    if (!lastEvent) throw new OrderNotFoundError(orderId);

    // State machine: pastikan OrderCreated sudah ada
    const orderCreated = await tx.eventLog.findFirst({
      where: { aggregateId: orderId, eventType: 'OrderCreated' },
    });
    if (!orderCreated) {
      throw new StateConflictError(
        `Pesanan ${orderId} belum dalam status OrderCreated`,
      );
    }

    // State machine: cegah pembayaran ganda
    const alreadyPaid = await tx.eventLog.findFirst({
      where: { aggregateId: orderId, eventType: 'PaymentConfirmed' },
    });
    if (alreadyPaid) {
      throw new StateConflictError(
        'Pesanan ini sudah berhasil dibayar sebelumnya',
      );
    }

    // BUG #3 DIPERBAIKI: VersionConflict untuk concurrency safety
    // Kode asli tidak menangkap error P2002 (unique constraint violation).
    // Schema mengharuskan UNIQUE(aggregateId, version). Jika dua request
    // konkuren lolos pengecekan alreadyPaid secara bersamaan, keduanya
    // akan mencoba insert version yang sama → DB menolak salah satu
    // dengan constraint error. Kita tangkap dan ubah menjadi VersionConflictError
    // yang jelas bagi pemanggil API.
    const nextVersion = lastEvent.version + 1;
    let event;
    try {
      event = await tx.eventLog.create({
        data: {
          aggregateId: orderId,
          eventType: 'PaymentConfirmed',
          // BUG #2 (lanjutan): toFixed(4) untuk konsistensi presisi
          payload: { amount: decimalAmount.toFixed(4), chargeId: stripeId },
          version: nextVersion,
          idempotencyKey,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new VersionConflictError(
          `VersionConflict: pesanan ${orderId} versi ${nextVersion} sudah ada — concurrent write ditolak`,
        );
      }
      throw err;
    }

    // Double-entry: DEBIT payment_received, CREDIT order_balance
    await tx.ledger.create({
      data: { orderId, account: 'payment_received', debit: decimalAmount, credit: null },
    });
    await tx.ledger.create({
      data: { orderId, account: 'order_balance', debit: null, credit: decimalAmount },
    });

    return event;
  });
}

// ==========================================
// 3. FUNGSI PENGHITUNGAN BIAYA (3%)
// ==========================================
export async function calculateFees(
  orderId: string,
  amount: string,
  idempotencyKey: string,
) {
  const decimalAmount = new Prisma.Decimal(amount);

  // BUG #4 DIPERBAIKI: Pembulatan eksplisit setelah perkalian desimal
  // Kode asli: decimalAmount.mul(new Prisma.Decimal('0.03'))
  // Contoh kasus: 10 * 0.03 = 0.30 (oke), tapi 100/3 * 3 * 0.03 bisa
  // menghasilkan presisi tak terbatas dalam desimal. toDecimalPlaces(4)
  // memastikan hasil selalu 4 angka di belakang koma (Decimal(18,4))
  // sesuai spesifikasi schema, dengan rounding ROUND_HALF_UP standar finansial.
  const feeAmount = decimalAmount
    .mul(new Prisma.Decimal('0.03'))
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

  return await prisma.$transaction(async (tx) => {
    // IDEMPOTENCY
    const existingEvent = await tx.eventLog.findUnique({
      where: { idempotencyKey },
    });
    if (existingEvent) return existingEvent;

    // BUG #5 DIPERBAIKI: State machine — calculateFees hanya boleh
    // dipanggil setelah PaymentConfirmed. Kode asli tidak mengecek ini,
    // sehingga biaya bisa dihitung bahkan sebelum pembayaran terjadi.
    const paymentConfirmed = await tx.eventLog.findFirst({
      where: { aggregateId: orderId, eventType: 'PaymentConfirmed' },
    });
    if (!paymentConfirmed) {
      throw new StateConflictError(
        `Pembayaran belum dikonfirmasi untuk pesanan ${orderId}`,
      );
    }

    // BUG #5 (lanjutan): Cegah FeeCalculated duplikat
    const feeAlreadyCalculated = await tx.eventLog.findFirst({
      where: { aggregateId: orderId, eventType: 'FeeCalculated' },
    });
    if (feeAlreadyCalculated) {
      throw new StateConflictError(
        `Biaya sudah pernah dihitung untuk pesanan ${orderId}`,
      );
    }

    const lastEvent = await tx.eventLog.findFirst({
      where: { aggregateId: orderId },
      orderBy: { version: 'desc' },
    });
    if (!lastEvent) throw new OrderNotFoundError(orderId);

    let event;
    try {
      event = await tx.eventLog.create({
        data: {
          aggregateId: orderId,
          eventType: 'FeeCalculated',
          payload: { feeAmount: feeAmount.toFixed(4) },
          version: lastEvent.version + 1,
          idempotencyKey,
        },
      });
    } catch (err) {
      // BUG #3 (lanjutan): tangkap VersionConflict di sini juga
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new VersionConflictError(
          `VersionConflict: concurrent write pada pesanan ${orderId}`,
        );
      }
      throw err;
    }

    // Double-entry: DEBIT fees_owed, CREDIT payment_received
    await tx.ledger.create({
      data: { orderId, account: 'fees_owed', debit: feeAmount, credit: null },
    });
    await tx.ledger.create({
      data: { orderId, account: 'payment_received', debit: null, credit: feeAmount },
    });

    return event;
  });
}

// ==========================================
// 4. FUNGSI VERIFIKASI BUKU BESAR
// ==========================================
export async function verifyLedgerBalance(orderId: string) {
  const ledgers = await prisma.ledger.findMany({
    where: { orderId },
  });

  // BUG #6 DIPERBAIKI: Kembalikan error jelas jika orderId tidak ada
  // Kode asli mengembalikan isBalanced: true untuk orderId yang tidak ada
  // (0 - 0 = 0, dianggap balanced). Ini menyesatkan auditor.
  if (ledgers.length === 0) {
    throw new OrderNotFoundError(orderId);
  }

  let totalDebit = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);

  for (const entry of ledgers) {
    // BUG #7 DIPERBAIKI: null check eksplisit, bukan falsy check
    // Kode asli: if (entry.debit) — ini SALAH karena nilai 0 (Decimal)
    // bisa dievaluasi sebagai falsy tergantung implementasi. Akibatnya
    // entry dengan nilai 0.0000 bisa diabaikan dan menyebabkan
    // ketidakseimbangan buku besar yang tidak terdeteksi.
    // Fix: gunakan `!== null` yang eksplisit dan aman.
    if (entry.debit !== null) totalDebit = totalDebit.plus(entry.debit);
    if (entry.credit !== null) totalCredit = totalCredit.plus(entry.credit);
  }

  const balance = totalDebit.minus(totalCredit);
  const isBalanced = balance.equals(new Prisma.Decimal(0));

  return {
    orderId,
    totalDebit: totalDebit.toFixed(4),
    totalCredit: totalCredit.toFixed(4),
    balance: balance.toFixed(4),
    isBalanced,
  };
}

// ==========================================
// 5. FUNGSI PENCAIRAN DANA HARIAN (SETTLEMENT)
// ==========================================
export async function dailySettlement(date: string, idempotencyKey: string) {
  return await prisma.$transaction(async (tx) => {
    // IDEMPOTENCY: key sama → kembalikan event lama
    const existingEvent = await tx.eventLog.findUnique({
      where: { idempotencyKey },
    });
    if (existingEvent) return existingEvent;

    // BUG #8 DIPERBAIKI (bagian 1): Cegah settlement ganda untuk tanggal sama
    // Kode asli hanya mengandalkan idempotencyKey. Artinya jika dua request
    // datang dengan tanggal yang sama tapi key berbeda, settlement bisa
    // diproses dua kali → seller_payout dobel, ledger tidak balance.
    // Fix: cek apakah settlement untuk aggregateId tanggal ini sudah ada.
    const existingSettlement = await tx.eventLog.findFirst({
      where: {
        aggregateId: `settlement-${date}`,
        eventType: 'SettlementProcessed',
      },
    });
    if (existingSettlement) {
      throw new StateConflictError(
        `Settlement untuk tanggal ${date} sudah diproses sebelumnya`,
      );
    }

    // BUG #8 DIPERBAIKI (bagian 2): Filter ledger berdasarkan tanggal
    // Kode asli: tx.ledger.findMany({ where: { account: 'payment_received' } })
    // TANPA filter tanggal → mengambil SEMUA entri payment_received sejak awal,
    // termasuk yang sudah di-settle sebelumnya. Akibatnya:
    //   - Saldo settlement membengkak (double counting)
    //   - Setelah settlement, credit payment_received hanya ditambah satu kali
    //     tapi debitnya sudah terakumulasi dari hari-hari sebelumnya
    //   - verifyLedgerBalance() akan menunjukkan ketidakseimbangan
    // Fix: filter dengan timestamp hari ini saja (UTC).
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const ledgers = await tx.ledger.findMany({
      where: {
        account: 'payment_received',
        timestamp: { gte: startOfDay, lte: endOfDay },
      },
    });

    let balance = new Prisma.Decimal(0);
    for (const entry of ledgers) {
      // BUG #7 (lanjutan): null check eksplisit di sini juga
      if (entry.debit !== null) balance = balance.plus(entry.debit);
      if (entry.credit !== null) balance = balance.minus(entry.credit);
    }

    if (balance.lessThanOrEqualTo(0)) {
      throw new Error(
        `Tidak ada saldo bersih untuk dicairkan pada tanggal ${date}`,
      );
    }

    const event = await tx.eventLog.create({
      data: {
        aggregateId: `settlement-${date}`,
        eventType: 'SettlementProcessed',
        // BUG #2 (lanjutan): toFixed(4) untuk konsistensi
        payload: { date, amount: balance.toFixed(4) },
        version: 1,
        idempotencyKey,
      },
    });

    // Double-entry: DEBIT seller_payout, CREDIT payment_received
    await tx.ledger.create({
      data: {
        orderId: `settlement-${date}`,
        account: 'seller_payout',
        debit: balance,
        credit: null,
      },
    });
    await tx.ledger.create({
      data: {
        orderId: `settlement-${date}`,
        account: 'payment_received',
        debit: null,
        credit: balance,
      },
    });

    return event;
  });
}