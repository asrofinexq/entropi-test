// src/app/page.tsx
"use client";
import { useState } from 'react';
import OrderStatusCard from '@/components/OrderStatusCard';
import LedgerAuditTrail from '@/components/LedgerAuditTrail';
import { EventLog, LedgerEntry } from '@/types';

export default function Dashboard() {
  const [orderIdInput, setOrderIdInput] = useState('');
  const [events, setEvents] = useState<EventLog[]>([]);
  const [ledgers, setLedgers] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchOrderData = async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      // 1. Mengambil riwayat kejadian (Event Sourcing)
      const resEvents = await fetch(`http://localhost:8080/orders/${id}`);
      if (!resEvents.ok) throw new Error('Pesanan tidak ditemukan di database.');
      const dataEvents = await resEvents.json();
      setEvents(dataEvents);

      // 2. Mengambil riwayat buku besar (Ledger)
      const resLedgers = await fetch(`http://localhost:8080/orders/${id}/ledger`);
      if (resLedgers.ok) {
        const dataLedgers = await resLedgers.json();
        setLedgers(dataLedgers);
      }
    } catch (err: any) {
      setError(err.message);
      setEvents([]);
      setLedgers([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header & Fitur Pencarian */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Dasbor Penjual Entropi</h1>
            <p className="text-sm text-slate-500">Pantau status transaksi dan buku besar secara real-time.</p>
          </div>
          
          <div className="flex w-full md:w-auto gap-2">
            <input 
              type="text" 
              placeholder="Masukkan Order ID..." 
              value={orderIdInput}
              onChange={(e) => setOrderIdInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchOrderData(orderIdInput)}
              className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button 
              onClick={() => fetchOrderData(orderIdInput)}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition"
              disabled={loading}
            >
              {loading ? 'Mencari...' : 'Cari'}
            </button>
          </div>
        </div>

        {/* Pesan Error */}
        {error && (
          <div className="p-4 bg-red-100 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {/* Area Visualisasi Data */}
        {events.length > 0 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-end">
              <button 
                onClick={() => fetchOrderData(orderIdInput)}
                className="text-sm text-blue-600 hover:underline font-medium"
              >
                ↻ Segarkan Data
              </button>
            </div>
            
            <OrderStatusCard events={events} />
            <LedgerAuditTrail ledgers={ledgers} />
          </div>
        )}
        
      </div>
    </main>
  );
}