import supertest from 'supertest';
// Kita asumsikan server berjalan di localhost:8080 untuk testing
const request = supertest('http://localhost:8080'); 

describe('Financial Event Service API Tests', () => {
  const orderId = `TEST-ORD-${Date.now()}`;
  const idempotencyKey = `IDEMP-${Date.now()}`;

  // ==========================================
  // TES 1-4: PENGUJIAN INTI & KONKURENSI
  // ==========================================

  // Skenario 1: Happy Path & Presisi Desimal
  it('Harus membuat pesanan dengan nilai desimal presisi', async () => {
    const response = await request.post('/orders').send({
      orderId: orderId,
      amount: '150.5000',
      idempotencyKey: idempotencyKey,
    });

    expect(response.status).toBe(201);
    expect(response.body.payload.amount).toBe('150.5');
  });

  // Skenario 2: Idempotensi (Mencegah Pesanan Ganda)
  it('Harus menolak pembuatan pesanan jika idempotencyKey sama (Conflict)', async () => {
    const response = await request.post('/orders').send({
      orderId: orderId, 
      amount: '150.5000',
      idempotencyKey: 'kunci-berbeda', // Mencoba mengakali dengan kunci berbeda tapi aggregateId sama
    });

    expect(response.status).toBe(409);
  });

  // Skenario 3: Ujian Konkurensi Ekstrem (100 Request Bersamaan - Real World Load)
  it('Sistem sanggup menahan 100 permintaan pembayaran bersamaan tanpa korup', async () => {
    const concurrentRequests = [];
    
    for (let i = 0; i < 100; i++) {
      concurrentRequests.push(
        request.post(`/orders/${orderId}/pay`).send({
          amount: '150.5000',
          customerId: 'CUST-TEST',
          idempotencyKey: `PAY-${idempotencyKey}-${i}`, // Kunci beda untuk memicu VersionConflict
        })
      );
    }

    const responses = await Promise.all(concurrentRequests);

    // Evaluasi Realistis: 1 sukses, 99 gagal (Bisa 409 Version Conflict, atau 500 Connection Timeout)
    const successResponses = responses.filter(r => r.status === 200);
    const failedResponses = responses.filter(r => r.status !== 200);
    
    expect(successResponses.length).toBe(1);
    expect(failedResponses.length).toBe(99); 
  }, 15000); 

  // Skenario 4: Verifikasi Keseimbangan Buku Besar Mutlak
  it('Buku besar harus seimbang absolut (0) setelah operasi ekstrem', async () => {
    const response = await request.get(`/verify-ledger/${orderId}`);
    
    expect(response.status).toBe(200);
    expect(response.body.isBalanced).toBe(true);
    expect(response.body.balance).toBe('0');
  });

  // ==========================================
  // TES 5-9: KASUS EKSTREM & KONSISTENSI
  // ==========================================

  // Skenario 5: Edge Cases Presisi Desimal (Kalkulasi 3%)
  it('Harus menghitung potongan biaya admin 3% tanpa rounding error ($10 * 0.03 = 0.30)', async () => {
    const edgeOrderId = `EDGE-CALC-${Date.now()}`;
    const edgeIdemp = `EDGE-CALC-IDEMP-${Date.now()}`;

    // Buat pesanan senilai $10
    await request.post('/orders').send({
      orderId: edgeOrderId,
      amount: '10.0000',
      idempotencyKey: edgeIdemp,
    });

    // Bayar pesanan
    const payResponse = await request.post(`/orders/${edgeOrderId}/pay`).send({
      amount: '10.0000',
      customerId: 'CUST-10',
      idempotencyKey: `PAY-${edgeIdemp}`,
    });

    expect(payResponse.status).toBe(200);
    // Memastikan potongan fee presisi mutlak 0.3
    expect(payResponse.body.feeEvent.payload.feeAmount).toBe('0.3');
  });

  // Skenario 6: Edge Cases Presisi Desimal (Angka Ekstrem Maksimal)
  it('Sistem sanggup menyimpan angka ekstrem 999,999.99 USD tanpa distorsi', async () => {
    const largeOrderId = `LARGE-${Date.now()}`;
    const response = await request.post('/orders').send({
      orderId: largeOrderId,
      amount: '999999.9900',
      idempotencyKey: `LARGE-IDEMP-${Date.now()}`,
    });

    expect(response.status).toBe(201);
    expect(response.body.payload.amount).toBe('999999.99');
  });

  // Skenario 7: Konsistensi Proyeksi (State Machine Berurutan)
  it('Riwayat kejadian (Event Sourcing) harus memiliki versi yang berurutan secara konsisten', async () => {
    const response = await request.get(`/orders/${orderId}`); // Menarik riwayat dari Skenario 1 & 3

    expect(response.status).toBe(200);
    const events = response.body;

    // Memastikan hanya ada tepat 3 event berurutan meskipun sempat dibombardir 99 request gagal
    expect(events.length).toBe(3);
    expect(events[0].eventType).toBe('OrderCreated');
    expect(events[0].version).toBe(1);
    
    expect(events[1].eventType).toBe('PaymentConfirmed');
    expect(events[1].version).toBe(2);
    
    expect(events[2].eventType).toBe('FeeCalculated');
    expect(events[2].version).toBe(3);
  });

  // Skenario 8: Invalid Transition (Pelanggaran State)
  it('Harus menolak pembayaran untuk pesanan yang tidak pernah dibuat', async () => {
    const response = await request.post('/orders/UNKNOWN-GHOST-ORDER/pay').send({
      amount: '100.0000',
      customerId: 'CUST-GHOST',
      idempotencyKey: `GHOST-IDEMP-${Date.now()}`,
    });

    // Mengembalikan 500 karena pesanan tidak ditemukan di database
    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/Pesanan tidak ditemukan/);
  });

  // Skenario 9: Idempotensi Settlement Harian
  it('Harus memberikan hasil mutlak sama bila proses Settlement harian dipanggil ganda', async () => {
    // PERBAIKAN: Menambahkan Date.now() agar tanggal Settlement unik di setiap kali pengujian dijalankan
    const dateStr = `2026-05-24-${Date.now()}`; 
    const settleIdempKey = `SETTLE-IDEMP-${Date.now()}`;

    // Panggilan Pertama
    const response1 = await request.post('/settle').send({
      date: dateStr,
      idempotencyKey: settleIdempKey
    });

    // Panggilan Kedua (Dengan kunci idempotensi yang sama persis)
    const response2 = await request.post('/settle').send({
      date: dateStr,
      idempotencyKey: settleIdempKey
    });

    // Keduanya harus berhasil (200) dan mengembalikan objek database yang sama persis (Idempotent)
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response1.body.id).toBe(response2.body.id);
  });
});