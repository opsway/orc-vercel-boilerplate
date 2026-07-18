#!/usr/bin/env node
/**
 * One-shot Dynamic Client Registration (RFC 7591) against ORC's OAuth server.
 *
 *   ORC_URL=https://help.opsway.com \
 *   APP_URL=http://localhost:3001 \
 *   [EXTRA_REDIRECT_URLS=https://my-app.vercel.app] \
 *   node scripts/register-client.mjs
 *
 * Registers a PUBLIC client (PKCE, no secret) allowed to run the
 * authorization-code + refresh-token flow with the `mcp offline_access`
 * scope. Prints the client_id to put in .env as ORC_CLIENT_ID.
 *
 * Register EVERY base URL the app will run on (local dev + the stable Vercel
 * production URL) in one go — the authorize request fails on any redirect_uri
 * that wasn't registered. Keep the registration_access_token if you'll ever
 * need to update the client (add a redirect URL later).
 */

const ORC_URL = (process.env.ORC_URL ?? 'https://help.opsway.com').replace(/\/+$/, '');
const APP_URL = process.env.APP_URL?.replace(/\/+$/, '');
if (!APP_URL) {
  console.error('Set APP_URL (e.g. APP_URL=http://localhost:3001)');
  process.exit(1);
}

const redirectUris = [
  `${APP_URL}/api/auth/callback`,
  ...(process.env.EXTRA_REDIRECT_URLS ?? '')
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((u) => `${u}/api/auth/callback`),
];

const res = await fetch(`${ORC_URL}/oauth2/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: process.env.CLIENT_NAME ?? 'ORC Sales Orders demo',
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // public client — PKCE instead of a secret
    scope: 'mcp offline_access',
  }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Registration failed (${res.status}):`, JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log('Registered OAuth client:\n');
console.log(`  ORC_CLIENT_ID=${body.client_id}`);
console.log(`  redirect_uris=${JSON.stringify(body.redirect_uris)}`);
console.log('\nKeep these if you ever need to UPDATE the client (RFC 7592):');
console.log(`  registration_client_uri=${body.registration_client_uri ?? '(not returned)'}`);
console.log(
  `  registration_access_token=${body.registration_access_token ?? '(not returned)'}`,
);
