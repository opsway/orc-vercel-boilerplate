import { ORC_URL, ORC_CLIENT_ID, ORC_ENV_ID } from './config';
import type { TokenSet } from './cookies';

/**
 * The ORC client used by this app's backend routes.
 *
 * ORC exposes its whole tool plane as ONE stateless MCP endpoint
 * (`POST ${ORC_URL}/mcp`, JSON-RPC 2.0) guarded by the OAuth access token.
 * Every Odoo call goes through the `orc_call_tool` meta-tool; Odoo credentials
 * never reach this app — ORC resolves them server-side for the LOGGED-IN USER
 * and persona-gates every call. This app only ever holds the user's ORC OAuth
 * token, which the user can revoke at any time.
 */

/** Thrown when the user must (re-)login — routes translate it to a 401. */
export class AuthRequiredError extends Error {
  constructor(message = 'ORC login required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

type RefreshOutcome = { tokens: TokenSet; rotated: boolean };

/**
 * Ensure the access token is fresh; refresh via the rotating refresh token
 * when it has <60 s left. Hydra ROTATES refresh tokens on every use — the
 * caller MUST persist the returned token set whenever `rotated` is true, or
 * the next refresh will fail.
 */
export async function ensureFreshTokens(tokens: TokenSet): Promise<RefreshOutcome> {
  if (Date.now() < tokens.expires_at - 60_000) {
    return { tokens, rotated: false };
  }
  if (!tokens.refresh_token) throw new AuthRequiredError('access token expired');

  const res = await fetch(`${ORC_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: ORC_CLIENT_ID,
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    // Refresh token expired, revoked, or lost a rotation race → full re-login.
    throw new AuthRequiredError(`token refresh failed (${res.status})`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    rotated: true,
    tokens: {
      access_token: data.access_token,
      // Rotation: always take the NEW refresh token when present.
      refresh_token: data.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    },
  };
}

type McpContent = { type: string; text?: string; [k: string]: unknown };
type McpToolResult = { content?: McpContent[]; isError?: boolean };

/** One JSON-RPC round-trip to ORC's /mcp endpoint. */
async function mcpRequest(
  accessToken: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${ORC_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  });
  if (res.status === 401) throw new AuthRequiredError('ORC rejected the access token');
  const envelope = (await res.json().catch(() => null)) as
    | { result?: unknown; error?: { message?: string } }
    | null;
  if (!res.ok || !envelope) throw new Error(`ORC /mcp HTTP ${res.status}`);
  if (envelope.error) throw new Error(envelope.error.message ?? 'ORC /mcp error');
  return envelope.result;
}

/**
 * Call one remote tool on the app's pinned environment through ORC's
 * `orc_call_tool` meta-tool. Returns the remote tool's first text block,
 * JSON-parsed when possible (odoo-mcp returns JSON text).
 */
export async function orcCallTool(
  accessToken: string,
  namespace: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = (await mcpRequest(accessToken, 'tools/call', {
    name: 'orc_call_tool',
    arguments: { env: ORC_ENV_ID, namespace, name, arguments: args },
  })) as McpToolResult;

  const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
  if (result.isError) {
    // ORC multiplexes persona-denied / no-key / Odoo errors into this bucket;
    // the message names the real cause — surface it verbatim.
    throw new Error(text || 'tool call failed');
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The one Odoo read this demo performs: recent Sales Orders. */
export async function fetchSalesOrders(accessToken: string): Promise<
  Array<{
    id: number;
    name: string;
    partner_id: [number, string] | false;
    date_order: string;
    amount_total: number;
    state: string;
    currency_id: [number, string] | false;
  }>
> {
  const rows = await orcCallTool(accessToken, 'odoo', 'odoo_search_read', {
    model: 'sale.order',
    fields: ['name', 'partner_id', 'date_order', 'amount_total', 'state', 'currency_id'],
    order: 'date_order desc',
    limit: 25,
  });
  if (!Array.isArray(rows)) throw new Error('unexpected odoo_search_read payload');
  return rows;
}
