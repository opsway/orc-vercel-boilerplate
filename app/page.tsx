import { cookies } from 'next/headers';
import { tokensCookieName } from '@/lib/cookies';
import SalesOrders from './sales-orders';

/**
 * Landing page. Server component: only checks whether a token cookie exists
 * (the tokens themselves stay HttpOnly / backend-only). Logged out → a single
 * "Log in with ORC" button; logged in → the Sales Orders table.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const store = await cookies();
  const loggedIn = store.has(tokensCookieName());
  const { error } = await searchParams;

  return (
    <main>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Sales Orders</h1>
        {loggedIn && (
          <a href="/api/auth/logout" style={{ fontSize: 13, color: '#5f6673' }}>
            Log out
          </a>
        )}
      </header>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#5f6673' }}>
        Odoo data via ORC — per-user OAuth, credentials stay server-side.
      </p>

      {error && (
        <div
          style={{
            background: '#fdecea',
            border: '1px solid #f5c6c0',
            color: '#a94442',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loggedIn ? (
        <SalesOrders />
      ) : (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e4e7ec',
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
          }}
        >
          <p style={{ marginTop: 0 }}>Sign in with your ORC account to see the orders.</p>
          <a
            href="/api/auth/login"
            style={{
              display: 'inline-block',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 8,
              padding: '10px 22px',
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Log in with ORC
          </a>
        </div>
      )}
    </main>
  );
}
