// src/components/OrderStatusCard.tsx
import { EventLog } from '@/types';

export default function OrderStatusCard({ events }: { events: EventLog[] }) {
  if (!events || events.length === 0) {
    return <div className="p-4 bg-gray-50 rounded-lg text-gray-500">Pesanan belum ditemukan...</div>;
  }

  // Calculate all financial values from events
  let amount = '0';
  let fee = '0';
  let payout = '0';
  let status = 'pending_payment';
  let orderId = '';
  let createdAt = '';
  let chargeId = '';

  events.forEach((event) => {
    orderId = event.aggregateId;
    if (event.timestamp) createdAt = new Date(event.timestamp).toLocaleString('id-ID');
    
    if (event.eventType === 'OrderCreated') {
      amount = event.payload.amount || '0';
      status = 'pending_payment';
    }
    if (event.eventType === 'PaymentConfirmed') {
      status = 'payment_confirmed';
      chargeId = event.payload.chargeId || '';
    }
    if (event.eventType === 'FeeCalculated') {
      fee = event.payload.feeAmount || '0';
      status = 'fees_calculated';
    }
    if (event.eventType === 'SettlementProcessed') {
      status = 'settled';
      payout = event.payload.payoutAmount || payout;
    }
  });

  // Calculate payout if not already set
  if (payout === '0' && amount !== '0' && fee !== '0') {
    const amountNum = parseFloat(amount);
    const feeNum = parseFloat(fee);
    payout = (amountNum - feeNum).toFixed(2);
  }

  const statusConfig = {
    pending_payment: { label: 'MENUNGGU PEMBAYARAN', color: 'bg-yellow-100 text-yellow-700', icon: '⏳' },
    payment_confirmed: { label: 'PEMBAYARAN TERKONFIRMASI', color: 'bg-blue-100 text-blue-700', icon: '✓' },
    fees_calculated: { label: 'BIAYA DIHITUNG', color: 'bg-cyan-100 text-cyan-700', icon: '📊' },
    settled: { label: 'SUDAH DICAIRKAN', color: 'bg-green-100 text-green-700', icon: '✓✓' },
  };

  const currentStatus = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending_payment;

  return (
    <div className="space-y-4">
      {/* Main Status Card */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Status Pesanan</h2>
            <p className="text-sm text-gray-500 mt-1">Order ID: <span className="font-mono text-gray-700">{orderId}</span></p>
            <p className="text-xs text-gray-400 mt-1">Dibuat: {createdAt}</p>
          </div>
          <span className={`px-4 py-2 rounded-full text-sm font-bold tracking-wide whitespace-nowrap ${currentStatus.color}`}>
            {currentStatus.icon} {currentStatus.label}
          </span>
        </div>

        {/* Financial Details Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {/* Order Amount */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-5 rounded-lg border border-blue-200">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Jumlah Pesanan</p>
            <p className="text-2xl font-bold text-blue-900 mt-2">${parseFloat(amount).toFixed(2)}</p>
            <p className="text-xs text-blue-600 mt-1">Total tagihan</p>
          </div>

          {/* Fee */}
          <div className="bg-gradient-to-br from-red-50 to-red-100 p-5 rounded-lg border border-red-200">
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Biaya Platform</p>
            <p className="text-2xl font-bold text-red-900 mt-2">-${parseFloat(fee).toFixed(2)}</p>
            <p className="text-xs text-red-600 mt-1">3% dari total</p>
          </div>

          {/* Payout */}
          <div className="bg-gradient-to-br from-green-50 to-green-100 p-5 rounded-lg border border-green-200">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">Pencairan Bersih</p>
            <p className="text-2xl font-bold text-green-900 mt-2">${parseFloat(payout).toFixed(2)}</p>
            <p className="text-xs text-green-600 mt-1">Jumlah final</p>
          </div>

          {/* Charge ID */}
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-5 rounded-lg border border-purple-200">
            <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">ID Transaksi</p>
            <p className="text-sm font-mono text-purple-900 mt-2 break-all">{chargeId || '-'}</p>
            <p className="text-xs text-purple-600 mt-1">Stripe reference</p>
          </div>
        </div>
      </div>

      {/* Event Timeline */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Riwayat Kejadian</h3>
        <div className="space-y-3">
          {events.map((event, idx) => (
            <div key={event.id} className="flex gap-4 pb-3 last:pb-0 last:border-b-0 border-b">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 text-blue-600 font-bold text-sm">
                  {idx + 1}
                </div>
              </div>
              <div className="flex-grow">
                <p className="font-semibold text-gray-900">{event.eventType}</p>
                <p className="text-sm text-gray-500">Version {event.version} • {new Date(event.timestamp).toLocaleString('id-ID')}</p>
                <p className="text-xs text-gray-400 mt-1 font-mono">ID Idempotency: {event.idempotencyKey.substring(0, 16)}...</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}