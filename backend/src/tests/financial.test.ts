import supertest from 'supertest';
const request = supertest('https://entropi-test-production.up.railway.app'); 

describe('Financial Event Service API Tests', () => {
  const orderId = `TEST-ORD-${Date.now()}`;
  const idempotencyKey = `IDEMP-${Date.now()}`;

  it('Harus membuat pesanan dengan nilai desimal presisi', async () => {
    const response = await request.post('/orders').send({
      orderId: orderId,
      amount: '150.5000',
      idempotencyKey: idempotencyKey,
    });

    expect(response.status).toBe(201);
    expect(response.body.payload.amount).toBe('150.5');
  });

  it('Harus menolak pembuatan pesanan jika idempotencyKey sama (Conflict)', async () => {
    const response = await request.post('/orders').send({
      orderId: orderId, 
      amount: '150.5000',
      idempotencyKey: 'kunci-berbeda', 
    });

    expect(response.status).toBe(409);
  });

  
  it('Sistem sanggup menahan 100 permintaan pembayaran bersamaan tanpa korup', async () => {
    const concurrentRequests = [];
    
    for (let i = 0; i < 100; i++) {
      concurrentRequests.push(
        request.post(`/orders/${orderId}/pay`).send({
          amount: '150.5000',
          customerId: 'CUST-TEST',
          idempotencyKey: `PAY-${idempotencyKey}-${i}`, 
        })
      );
    }

    const responses = await Promise.all(concurrentRequests);

    const successResponses = responses.filter(r => r.status === 200);
    const failedResponses = responses.filter(r => r.status !== 200);
    
    expect(successResponses.length).toBe(1);
    expect(failedResponses.length).toBe(99); 
  }, 125000); 

  it('Buku besar harus seimbang absolut (0) setelah operasi ekstrem', async () => {
    const response = await request.get(`/verify-ledger/${orderId}`);
    
    expect(response.status).toBe(200);
    expect(response.body.isBalanced).toBe(true);
    expect(response.body.balance).toBe('0');
  });


  it('Harus menghitung potongan biaya admin 3% tanpa rounding error ($10 * 0.03 = 0.30)', async () => {
    const edgeOrderId = `EDGE-CALC-${Date.now()}`;
    const edgeIdemp = `EDGE-CALC-IDEMP-${Date.now()}`;

    await request.post('/orders').send({
      orderId: edgeOrderId,
      amount: '10.0000',
      idempotencyKey: edgeIdemp,
    });

    const payResponse = await request.post(`/orders/${edgeOrderId}/pay`).send({
      amount: '10.0000',
      customerId: 'CUST-10',
      idempotencyKey: `PAY-${edgeIdemp}`,
    });

    expect(payResponse.status).toBe(200);
    expect(payResponse.body.feeEvent.payload.feeAmount).toBe('0.3');
  });

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

  it('Riwayat kejadian (Event Sourcing) harus memiliki versi yang berurutan secara konsisten', async () => {
    const response = await request.get(`/orders/${orderId}`); 

    expect(response.status).toBe(200);
    const events = response.body;

    expect(events.length).toBe(3);
    expect(events[0].eventType).toBe('OrderCreated');
    expect(events[0].version).toBe(1);
    
    expect(events[1].eventType).toBe('PaymentConfirmed');
    expect(events[1].version).toBe(2);
    
    expect(events[2].eventType).toBe('FeeCalculated');
    expect(events[2].version).toBe(3);
  });

  it('Harus menolak pembayaran untuk pesanan yang tidak pernah dibuat', async () => {
    const response = await request.post('/orders/UNKNOWN-GHOST-ORDER/pay').send({
      amount: '100.0000',
      customerId: 'CUST-GHOST',
      idempotencyKey: `GHOST-IDEMP-${Date.now()}`,
    });

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/Pesanan tidak ditemukan/);
  });

  it('Harus memberikan hasil mutlak sama bila proses Settlement harian dipanggil ganda', async () => {
    const dateStr = `2026-05-24-${Date.now()}`; 
    const settleIdempKey = `SETTLE-IDEMP-${Date.now()}`;

    const response1 = await request.post('/settle').send({
      date: dateStr,
      idempotencyKey: settleIdempKey
    });

    const response2 = await request.post('/settle').send({
      date: dateStr,
      idempotencyKey: settleIdempKey
    });

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response1.body.id).toBe(response2.body.id);
  });
});