// src/components/OrderStatusCard.tsx
import { EventLog } from '@/types';

export default function OrderStatusCard({ events }: { events: EventLog[] }) {
  if (!events || events.length === 0) {
    return <div className="p-4 bg-gray-50 rounded-lg text-gray-500">Pesanan belum ditemukan...</div>;
  }

  // State Machine Projection: Menghitung nilai akhir berdasarkan riwayat kejadian
  let amount = 0;
  let fee = 0;
  let isPaid = false;

  events.forEach((event) => {
    if (event.eventType === 'OrderCreated') amount = parseFloat(event.payload.amount);
    if (event.eventType === 'PaymentConfirmed') isPaid = true;
    if (event.eventType === 'FeeCalculated') fee = parseFloat(event.payload.feeAmount);
  });

  const payout = amount - fee;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-4">
      <div className="flex justify-between items-center border-b pb-4">
        <h2 className="text-lg font-bold text-gray-800">Status Pesanan</h2>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold tracking-wide ${isPaid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
          {isPaid ? 'LUNAS' : 'MENUNGGU PEMBAYARAN'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-sm text-gray-500 mb-1">Total Tagihan</p>
          <p className="text-xl font-bold text-gray-900">${amount.toFixed(2)}</p>
        </div>
        <div className="bg-red-50 p-4 rounded-lg">
          <p className="text-sm text-red-400 mb-1">Potongan Biaya (3%)</p>
          <p className="text-xl font-bold text-red-600">-${fee.toFixed(2)}</p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <p className="text-sm text-green-600 mb-1">Estimasi Pencairan</p>
          <p className="text-xl font-bold text-green-700">${payout.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}