import { NextRequest, NextResponse } from 'next/server';
import { ORC_URL, ORC_CLIENT_ID, APP_URL } from '@/lib/config';
import { readTokens, clearTokens } from '@/lib/cookies';

export const runtime = 'nodejs';

/**
 * GET /api/auth/logout — clear the local token cookie and best-effort revoke
 * the refresh token at ORC (RFC 7009), so the grant doesn't linger server-side.
 */
export async function GET(req: NextRequest) {
  const tokens = readTokens(req);
  if (tokens?.refresh_token) {
    await fetch(`${ORC_URL}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: tokens.refresh_token,
        token_type_hint: 'refresh_token',
        client_id: ORC_CLIENT_ID,
      }),
      cache: 'no-store',
    }).catch(() => undefined);
  }
  const res = NextResponse.redirect(`${APP_URL}/`, { status: 303 });
  clearTokens(res);
  return res;
}
