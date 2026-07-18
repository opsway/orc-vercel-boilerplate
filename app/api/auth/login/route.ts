import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import {
  ORC_URL,
  ORC_CLIENT_ID,
  ORC_ENV_ID,
  REDIRECT_URI,
  OAUTH_SCOPE,
  OAUTH_RESOURCE,
} from '@/lib/config';
import { setOAuthTransient } from '@/lib/cookies';

export const runtime = 'nodejs';

/**
 * GET /api/auth/login — start the OAuth 2.0 authorization-code + PKCE flow.
 *
 * Redirects the browser to ORC's authorize endpoint. The user authenticates
 * ON ORC (existing session or Google SSO) — this app never sees credentials.
 * `state` (CSRF) + the PKCE `verifier` ride in a short-lived HttpOnly cookie
 * until the callback.
 */
export async function GET() {
  const state = randomBytes(16).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const authorize = new URL(`${ORC_URL}/oauth2/auth`);
  authorize.searchParams.set('client_id', ORC_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', REDIRECT_URI);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', OAUTH_SCOPE);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  // RFC 8707: binds the token to ORC's /mcp resource (tenant claim). Required.
  // NB: no `audience` param — Hydra rejects it for DCR clients; ORC's consent
  // step grants aud=mcp on its own.
  authorize.searchParams.set('resource', OAUTH_RESOURCE);
  // Environment-scoping request (GitHub-style): ask for exactly the one
  // environment this app is pinned to. ORC's consent screen pre-checks it and
  // the USER confirms; the resulting token is then valid only for it — this
  // app could not read any other Odoo instance even if its code tried.
  authorize.searchParams.set('envs', ORC_ENV_ID);

  const res = NextResponse.redirect(authorize.toString(), { status: 303 });
  setOAuthTransient(res, { state, verifier });
  return res;
}
