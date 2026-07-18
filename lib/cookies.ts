import type { NextRequest, NextResponse } from 'next/server';

/**
 * Two HttpOnly cookies, both invisible to client-side JS:
 *
 *  - `orc_oauth`  — transient state for the in-flight OAuth dance
 *                   (CSRF `state` + PKCE `verifier`), 10 min.
 *  - `orc_tokens` — the OAuth token set after login. The browser never
 *                   sees the tokens; only this app's own backend reads
 *                   them and forwards the access token to ORC.
 */

export type OAuthTransient = { state: string; verifier: string };
export type TokenSet = {
  access_token: string;
  refresh_token: string | null;
  /** epoch ms when the access token expires */
  expires_at: number;
};

const OAUTH_COOKIE = 'orc_oauth';
const TOKENS_COOKIE = 'orc_tokens';

const base = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export function setOAuthTransient(res: NextResponse, value: OAuthTransient): void {
  res.cookies.set(OAUTH_COOKIE, JSON.stringify(value), { ...base, maxAge: 600 });
}

export function readOAuthTransient(req: NextRequest): OAuthTransient | null {
  const raw = req.cookies.get(OAUTH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OAuthTransient>;
    return typeof v.state === 'string' && typeof v.verifier === 'string'
      ? { state: v.state, verifier: v.verifier }
      : null;
  } catch {
    return null;
  }
}

export function clearOAuthTransient(res: NextResponse): void {
  res.cookies.set(OAUTH_COOKIE, '', { ...base, maxAge: 0 });
}

/** Cookie lifetime tracks the refresh token (30 d), not the 1 h access token. */
export function setTokens(res: NextResponse, tokens: TokenSet): void {
  res.cookies.set(TOKENS_COOKIE, JSON.stringify(tokens), {
    ...base,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function readTokens(req: NextRequest): TokenSet | null {
  const raw = req.cookies.get(TOKENS_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TokenSet>;
    return typeof v.access_token === 'string' && typeof v.expires_at === 'number'
      ? {
          access_token: v.access_token,
          refresh_token: typeof v.refresh_token === 'string' ? v.refresh_token : null,
          expires_at: v.expires_at,
        }
      : null;
  } catch {
    return null;
  }
}

export function clearTokens(res: NextResponse): void {
  res.cookies.set(TOKENS_COOKIE, '', { ...base, maxAge: 0 });
}

/** Server-component variant (read-only) — `has` check for the landing page. */
export function tokensCookieName(): string {
  return TOKENS_COOKIE;
}
