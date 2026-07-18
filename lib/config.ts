/** Central config — every value comes from env so a fork changes nothing here. */

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

/** ORC base URL — OAuth issuer AND /mcp host. No trailing slash. */
export const ORC_URL = required('ORC_URL').replace(/\/+$/, '');

/** OAuth client id from Dynamic Client Registration (npm run register-client). */
export const ORC_CLIENT_ID = required('ORC_CLIENT_ID');

/** The one ORC environment (Odoo instance) this app reads. UUID from `orc envs`. */
export const ORC_ENV_ID = required('ORC_ENV_ID');

/** Public base URL of this app; redirect_uri = `${APP_URL}/api/auth/callback`. */
export const APP_URL = required('APP_URL').replace(/\/+$/, '');

export const REDIRECT_URI = `${APP_URL}/api/auth/callback`;

/**
 * Scopes: `mcp` is what the ORC resource server (`/mcp`) requires;
 * `offline_access` makes Hydra issue a refresh token (access tokens live 1h).
 */
export const OAUTH_SCOPE = 'mcp offline_access';

/**
 * RFC 8707 resource indicator. REQUIRED on the authorize request: ORC resolves
 * the tenant for the token from this value and stamps it into the JWT; /mcp
 * then only accepts the token on the matching host. Omit it and calls to a
 * tenant-bound host 403.
 *
 * Do NOT send an `audience` param — Hydra rejects it for DCR clients
 * ("audience not whitelisted"); ORC's consent step force-grants aud=mcp.
 */
export const OAUTH_RESOURCE = `${ORC_URL}/mcp`;
