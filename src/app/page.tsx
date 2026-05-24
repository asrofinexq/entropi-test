// src/app/page.tsx
"use client";
import { useState, useEffect } from 'react';
import OrderStatusCard from '@/components/OrderStatusCard';
import LedgerAuditTrail from '@/components/LedgerAuditTrail';
import OrderList from '@/components/OrderList';
import { EventLog, LedgerEntry } from '@/types';

// Tipe data tambahan untuk daftar order
interface OrderData {
  id: string;
  payment_received?: string | number | null;
}

export default function Dashboard() {
  const [orderIdInput, setOrderIdInput] = useState('');
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  
  const [events, setEvents] = useState<EventLog[]>([]);
  const [ledgers, setLedgers] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 1. Ambil daftar pesanan saat halaman pertama kali dimuat
  useEffect(() => {
    fetchAllOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAllOrders = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/orders`);
      const data = await res.json();
      if (data.success && data.orders && data.orders.length > 0) {
        setOrders(data.orders);
        
        // FITUR BARU: Otomatis langsung membuka pesanan urutan pertama (terbaru)
        if (!selectedOrderId) {
          fetchOrderData(data.orders[0].id);
        }
      }
    } catch (err) {
      console.error("Gagal mengambil daftar pesanan:", err);
    }
  };

  // 2. Ambil detail pesanan (Event Sourcing & Ledger)
  const fetchOrderData = async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError('');
    setSelectedOrderId(id);
    setOrderIdInput(id); // Sinkronkan dengan input bar

    try {
      const resEvents = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/orders/${id}`);
      if (!resEvents.ok) throw new Error('Pesanan tidak ditemukan di database.');
      const dataEvents = await resEvents.json();
      setEvents(dataEvents);

      const resLedgers = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/orders/${id}/ledger`);
      if (resLedgers.ok) {
        const dataLedgers = await resLedgers.json();
        setLedgers(dataLedgers);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Terjadi kesalahan yang tidak diketahui.';
      setError(errorMessage);
      setEvents([]);
      setLedgers([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header & Fitur Pencarian */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Dasbor Penjual Entropi</h1>
            <p className="text-sm text-slate-500">Pantau status transaksi dan buku besar secara real-time.</p>
          </div>
          
          <div className="flex w-full md:w-auto gap-2">
            <input 
              type="text" 
              placeholder="Cari ID Pesanan..." 
              value={orderIdInput}
              onChange={(e) => setOrderIdInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchOrderData(orderIdInput)}
              className="flex-1 md:w-64 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
            />
            <button 
              onClick={() => fetchOrderData(orderIdInput)}
              className="px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition"
              disabled={loading}
            >
              {loading ? 'Mencari...' : 'Cari'}
            </button>
          </div>
        </div>

        {/* Pesan Error */}
        {error && (
          <div className="p-4 bg-red-100 border border-red-200 text-red-700 rounded-lg animate-in fade-in">
            {error}
          </div>
        )}

        {/* Layout Grid Utama: Kiri (Daftar) dan Kanan (Detail) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Kolom Kiri: Daftar Pesanan */}
          <div className="lg:col-span-1 flex flex-col gap-4">
            <OrderList 
              orders={orders} 
              onSelectOrder={fetchOrderData} 
              selectedOrderId={selectedOrderId}
            />
            <button 
              onClick={fetchAllOrders}
              className="w-full bg-white border border-gray-200 shadow-sm py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition text-gray-600"
            >
              ↻ Segarkan Daftar
            </button>
          </div>

          {/* Kolom Kanan: Area Visualisasi Data */}
          <div className="lg:col-span-2 space-y-6">
            {!selectedOrderId && !loading && events.length === 0 && (
              <div className="bg-white p-12 rounded-xl border border-dashed border-gray-300 text-center flex flex-col items-center justify-center text-gray-400">
                <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                <p>Belum ada data pesanan yang bisa ditampilkan. Silakan buat pesanan baru.</p>
              </div>
            )}

            {loading && (
              <div className="bg-white p-12 rounded-xl border border-gray-100 text-center text-gray-500 animate-pulse">
                Memuat data pesanan...
              </div>
            )}

            {events.length > 0 && !loading && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-center">
                  <h2 className="font-bold text-lg text-gray-700">Detail Pesanan: <span className="text-blue-600">{selectedOrderId}</span></h2>
                  <button 
                    onClick={() => fetchOrderData(selectedOrderId!)}
                    className="text-sm text-blue-600 hover:underline font-medium"
                  >
                    ↻ Segarkan Detail
                  </button>
                </div>
                <OrderStatusCard events={events} />
                <LedgerAuditTrail ledgers={ledgers} />
              </div>
            )}
          </div>
          
        </div>
      </div>
    </main>
  );
}