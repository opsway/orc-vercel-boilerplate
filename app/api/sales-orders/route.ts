import { NextRequest, NextResponse } from 'next/server';
import { readTokens, setTokens, clearTokens } from '@/lib/cookies';
import { ensureFreshTokens, fetchSalesOrders, AuthRequiredError } from '@/lib/orc';

export const runtime = 'nodejs';

/**
 * GET /api/sales-orders — the app's one data endpoint.
 *
 * Reads the user's token cookie, refreshes it if stale (persisting the rotated
 * refresh token), and asks ORC to run `odoo_search_read` on `sale.order` in the
 * pinned environment. ORC enforces, per LOGGED-IN USER: reach (do they hold a
 * usable key on that environment) and persona (is the tool allowed) — so two
 * colleagues using this same app can legitimately see different outcomes.
 */
export async function GET(req: NextRequest) {
  const stored = readTokens(req);
  if (!stored) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  try {
    const { tokens, rotated } = await ensureFreshTokens(stored);
    const orders = await fetchSalesOrders(tokens.access_token);
    const res = NextResponse.json({ ok: true, orders });
    if (rotated) setTokens(res, tokens); // rotation: persist or lose the session
    return res;
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      const res = NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
      clearTokens(res);
      return res;
    }
    const message = err instanceof Error ? err.message : 'unknown error';
    // Persona-denied / no-key / Odoo errors arrive here with a telling message.
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
