import { NextRequest, NextResponse } from 'next/server';
import { ORC_URL, ORC_CLIENT_ID, REDIRECT_URI, APP_URL } from '@/lib/config';
import {
  readOAuthTransient,
  clearOAuthTransient,
  setTokens,
} from '@/lib/cookies';

export const runtime = 'nodejs';

function failure(message: string): NextResponse {
  // Keep it simple: bounce home with the error in the query string.
  const res = NextResponse.redirect(
    `${APP_URL}/?error=${encodeURIComponent(message)}`,
    { status: 303 },
  );
  clearOAuthTransient(res);
  return res;
}

/**
 * GET /api/auth/callback — the OAuth redirect target.
 *
 * Verifies `state`, exchanges the code for tokens at ORC's token endpoint
 * (PKCE — public client, no secret), and stores the token set in an HttpOnly
 * cookie. Access token: 1 h; refresh token: 30 d (rotating).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const desc = url.searchParams.get('error_description') ?? '';
    return failure(`${oauthError}${desc ? `: ${desc}` : ''}`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const transient = readOAuthTransient(req);
  if (!code || !state || !transient || state !== transient.state) {
    return failure('OAuth state mismatch — please try logging in again');
  }

  const tokenRes = await fetch(`${ORC_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: ORC_CLIENT_ID,
      code_verifier: transient.verifier,
    }),
    cache: 'no-store',
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    return failure(`token exchange failed (${tokenRes.status}) ${body.slice(0, 200)}`);
  }

  const data = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const res = NextResponse.redirect(`${APP_URL}/`, { status: 303 });
  clearOAuthTransient(res);
  setTokens(res, {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_at: Date.now() + data.expires_in * 1000,
  });
  return res;
}
