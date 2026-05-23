// src/components/LedgerAuditTrail.tsx
import { LedgerEntry } from '@/types';

export default function LedgerAuditTrail({ ledgers }: { ledgers: LedgerEntry[] }) {
  if (!ledgers || ledgers.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-6">
      <div className="p-4 md:p-6 border-b bg-slate-50">
        <h2 className="text-lg font-bold text-gray-800">Jejak Audit Buku Besar (Ledger)</h2>
        <p className="text-sm text-gray-500">Mencatat setiap mutasi secara mutlak (Double-Entry)</p>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-sm border-b">
              <th className="p-4 font-semibold whitespace-nowrap">WAKTU (UTC)</th>
              <th className="p-4 font-semibold">AKUN (ACCOUNT)</th>
              <th className="p-4 font-semibold text-right">DEBIT</th>
              <th className="p-4 font-semibold text-right">KREDIT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ledgers.map((entry) => (
              <tr key={entry.id} className="hover:bg-gray-50 transition-colors text-sm">
                <td className="p-4 text-gray-500 whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleString('id-ID')}
                </td>
                <td className="p-4 font-medium text-gray-700">{entry.account}</td>
                <td className="p-4 text-right text-gray-900 font-mono">
                  {entry.debit ? `$${parseFloat(entry.debit).toFixed(2)}` : '-'}
                </td>
                <td className="p-4 text-right text-gray-900 font-mono">
                  {entry.credit ? `$${parseFloat(entry.credit).toFixed(2)}` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}