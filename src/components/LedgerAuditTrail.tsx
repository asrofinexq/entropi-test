// src/components/LedgerAuditTrail.tsx
import { LedgerEntry } from '@/types';

export default function LedgerAuditTrail({ ledgers }: { ledgers: LedgerEntry[] }) {
  if (!ledgers || ledgers.length === 0) return null;

  // Calculate running balance
  let runningBalance = 0;
  const ledgersWithBalance = ledgers.map((entry) => {
    const debit = entry.debit ? parseFloat(entry.debit) : 0;
    const credit = entry.credit ? parseFloat(entry.credit) : 0;
    runningBalance = parseFloat((runningBalance + debit - credit).toFixed(2));
    return {
      ...entry,
      runningBalance: runningBalance.toFixed(2),
    };
  });

  // Calculate totals
  const totalDebits = ledgers.reduce((sum, e) => {
    return sum + (e.debit ? parseFloat(e.debit) : 0);
  }, 0);

  const totalCredits = ledgers.reduce((sum, e) => {
    return sum + (e.credit ? parseFloat(e.credit) : 0);
  }, 0);

  const finalBalance = parseFloat((totalDebits - totalCredits).toFixed(2));
  const isBalanced = finalBalance === 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b bg-gradient-to-r from-slate-50 to-slate-100">
        <h2 className="text-xl font-bold text-gray-900">Jejak Audit Buku Besar (Ledger)</h2>
        <p className="text-sm text-gray-600 mt-1">Catatan lengkap setiap transaksi dengan sistem double-entry</p>
        
        {/* Balance Summary */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-white p-3 rounded-lg border border-gray-200">
            <p className="text-xs font-semibold text-gray-500 uppercase">Total Debit</p>
            <p className="text-lg font-bold text-blue-600 mt-1">${totalDebits.toFixed(2)}</p>
          </div>
          <div className="bg-white p-3 rounded-lg border border-gray-200">
            <p className="text-xs font-semibold text-gray-500 uppercase">Total Kredit</p>
            <p className="text-lg font-bold text-red-600 mt-1">${totalCredits.toFixed(2)}</p>
          </div>
          <div className={`p-3 rounded-lg border-2 ${
            isBalanced 
              ? 'bg-green-50 border-green-300' 
              : 'bg-red-50 border-red-300'
          }`}>
            <p className="text-xs font-semibold uppercase" style={{
              color: isBalanced ? '#059669' : '#dc2626'
            }}>
              {isBalanced ? '✓ Seimbang' : '✗ Imbalance'}
            </p>
            <p className="text-lg font-bold mt-1" style={{
              color: isBalanced ? '#059669' : '#dc2626'
            }}>${finalBalance.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-700 text-xs font-bold border-b-2 border-gray-300">
              <th className="p-4 whitespace-nowrap">NO</th>
              <th className="p-4 whitespace-nowrap">WAKTU (UTC)</th>
              <th className="p-4">AKUN</th>
              <th className="p-4 text-right">DEBIT</th>
              <th className="p-4 text-right">KREDIT</th>
              <th className="p-4 text-right font-bold">SALDO LARI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {ledgersWithBalance.map((entry, idx) => {
              const hasDebit = entry.debit && entry.debit !== '0';
              const hasCredit = entry.credit && entry.credit !== '0';
              
              return (
                <tr 
                  key={entry.id} 
                  className={`hover:bg-gray-50 transition-colors text-sm ${
                    idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  }`}
                >
                  <td className="p-4 text-gray-600 font-semibold text-center">{idx + 1}</td>
                  <td className="p-4 text-gray-600 whitespace-nowrap text-xs">
                    {new Date(entry.timestamp).toLocaleString('id-ID', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="p-4 font-medium text-gray-900 uppercase text-xs">
                    <span className="bg-gray-200 px-2 py-1 rounded">{entry.account}</span>
                  </td>
                  <td className={`p-4 text-right font-mono font-bold ${
                    hasDebit ? 'text-blue-600' : 'text-gray-400'
                  }`}>
                    {hasDebit ? `+$${parseFloat(entry.debit!).toFixed(2)}` : '-'}
                  </td>
                  <td className={`p-4 text-right font-mono font-bold ${
                    hasCredit ? 'text-red-600' : 'text-gray-400'
                  }`}>
                    {hasCredit ? `-$${parseFloat(entry.credit!).toFixed(2)}` : '-'}
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-gray-900 bg-yellow-50">
                    ${entry.runningBalance}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Summary */}
      <div className="p-4 bg-gray-50 border-t text-xs text-gray-600 flex justify-between">
        <span>Jumlah transaksi: <strong>{ledgers.length}</strong></span>
        <span>Catatan: <strong>Setiap transaksi harus seimbang (Debit = Kredit)</strong></span>
      </div>
    </div>
  );
}