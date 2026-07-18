'use client';

import { useEffect, useState } from 'react';

type Order = {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  date_order: string;
  amount_total: number;
  state: string;
  currency_id: [number, string] | false;
};

const STATE_LABELS: Record<string, string> = {
  draft: 'Quotation',
  sent: 'Quotation Sent',
  sale: 'Sales Order',
  done: 'Locked',
  cancel: 'Cancelled',
};

export default function SalesOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/sales-orders');
      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (res.status === 401) {
        setNeedsLogin(true);
      } else if (!res.ok || !data?.ok) {
        setError(data?.error || `HTTP ${res.status}`);
      } else {
        setOrders(data.orders as Order[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (needsLogin) {
    return (
      <p>
        Session expired — <a href="/api/auth/login">log in again</a>.
      </p>
    );
  }
  if (error) {
    // ORC's message usually names the real cause: persona-denied tool, no
    // usable key on the environment, or an Odoo-side failure.
    return <p style={{ color: '#a94442' }}>Could not load orders: {error}</p>;
  }
  if (!orders) return <p style={{ color: '#5f6673' }}>Loading orders…</p>;
  if (orders.length === 0) return <p>No sales orders found.</p>;

  const cell: React.CSSProperties = {
    padding: '10px 14px',
    borderBottom: '1px solid #eef0f3',
    fontSize: 13,
    textAlign: 'left',
  };

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e4e7ec',
        borderRadius: 12,
        overflowX: 'auto',
      }}
    >
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {['Number', 'Customer', 'Date', 'Total', 'Status'].map((h) => (
              <th key={h} style={{ ...cell, color: '#5f6673', fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td style={{ ...cell, fontFamily: 'ui-monospace, monospace' }}>{o.name}</td>
              <td style={cell}>{o.partner_id ? o.partner_id[1] : '—'}</td>
              <td style={cell}>{o.date_order?.slice(0, 10) ?? '—'}</td>
              <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                {o.amount_total.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                {o.currency_id ? o.currency_id[1] : ''}
              </td>
              <td style={cell}>{STATE_LABELS[o.state] ?? o.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
