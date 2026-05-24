// src/components/OrderList.tsx

interface Order {
  id: string;
  payment_received?: string | number | null;
}

interface OrderListProps {
  orders: Order[];
  onSelectOrder: (orderId: string) => void;
  selectedOrderId: string | null;
}

export default function OrderList({ orders, onSelectOrder, selectedOrderId }: OrderListProps) {
  if (!orders || orders.length === 0) {
    return <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 border">Belum ada pesanan masuk.</div>;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full">
      <div className="px-4 py-3 border-b bg-gray-50 flex justify-between items-center">
        <h2 className="font-bold text-gray-700">Daftar Pesanan</h2>
        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full">{orders.length} terbaru</span>
      </div>
      <div className="divide-y divide-gray-100 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        {orders.map((order) => {
          const isPaid = Number(order.payment_received || 0) > 0;
          const isSelected = order.id === selectedOrderId;

          return (
            <div 
              key={order.id} 
              onClick={() => onSelectOrder(order.id)}
              className={`p-4 cursor-pointer transition-colors hover:bg-blue-50 flex justify-between items-center
                ${isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}
              `}
            >
              <div className="overflow-hidden">
                <p className="font-semibold text-gray-800 text-sm truncate w-32 md:w-48" title={order.id}>{order.id}</p>
                <p className="text-[11px] text-gray-400 mt-1">Klik untuk detail</p>
              </div>
              <span className={`px-2 py-1 rounded text-[10px] font-bold ${isPaid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {isPaid ? 'LUNAS' : 'PENDING'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}