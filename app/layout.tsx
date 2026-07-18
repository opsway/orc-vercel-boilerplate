import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Sales Orders — ORC demo',
  description: 'Boilerplate: an external app reading Odoo through ORC with per-user OAuth',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (ColorZilla et al.) stamp
          attributes like cz-shortcut-listen onto <body> before React hydrates —
          a false-positive mismatch we can't control from the app. */}
      <body
        suppressHydrationWarning
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: '#f6f7f9',
          color: '#1a1d21',
        }}
      >
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px' }}>
          {children}
        </div>
      </body>
    </html>
  );
}
