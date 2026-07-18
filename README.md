# ORC Vercel boilerplate — build an Odoo app without touching Odoo credentials

A minimal, copy-me Next.js app showing the **intended way to build applications
on top of Odoo via ORC**: the user logs in with their own ORC account (OAuth 2.0),
and the app's backend reads Odoo through ORC's `/mcp` endpoint. This demo lists
recent Sales Orders; swap one function to make it do anything else.

**The app never sees an Odoo credential, an API key, or a password.** ORC holds
the keys server-side, resolves them per logged-in user, and persona-gates every
call. You get a deployable app; ORC keeps the security.

## How it works

```
Browser ── "Log in with ORC" ──▶ ORC (help.opsway.com)
              │                    ├─ login: existing ORC session or Google SSO
              │                    └─ consent screen: WHO is asking (this app),
              │                       WHAT scopes, and WHICH environments —
              │                       this app pre-selects its one environment
Browser ◀── redirect back ──────── authorization code
App backend ── code + PKCE ──────▶ ORC /oauth2/token  → access + refresh token
                                     (stored in an HttpOnly cookie — JS never sees it)

Every data request:
Browser ──▶ /api/sales-orders (this app's backend)
              └─ Bearer <user's token> ──▶ ORC /mcp
                   orc_call_tool { env, odoo_search_read }   ← env-grant enforced
                        └──▶ Odoo (credentials held by ORC, per-user)
```

Why route through ORC instead of hitting Odoo directly:

- **No credential sharing** — keys live in ORC; rotating them never touches
  deployed apps.
- **Per-user identity** — every call runs as the logged-in user with their own
  permissions; two colleagues can legitimately see different data.
- **Environment-scoped consent** — the token is server-side bound to the
  environment(s) the user approved on the consent screen. This app requests
  exactly one; it *cannot* read any other Odoo instance, even if its code tried.
- **Zero-trust apps** — anyone can register an app (Dynamic Client
  Registration, no admin needed); each grant is per-(user, app), expiring, and
  revocable on its own.

## Prerequisites

- An **ORC account** (the deployment this README assumes is
  `https://help.opsway.com` — any ORC with the OAuth connector works, set
  `ORC_URL` accordingly) with access to at least one environment.
- **Node 20+**.
- Optional but useful: the [`orc` CLI](https://github.com/opsway/odoo-agent-gateway/tree/master/tools/orc-cli)
  to discover environment IDs and remote tools.

## Quickstart (local)

1. **Get the code** (clone, or copy the folder — nothing here is
   deployment-specific):

   ```sh
   git clone https://github.com/opsway/orc-vercel-boilerplate.git
   cd orc-vercel-boilerplate && npm install
   ```

2. **Register your OAuth client** (one-time, self-serve — no admin involved):

   ```sh
   APP_URL=http://localhost:3001 CLIENT_NAME="My Sales Orders app" npm run register-client
   ```

   This performs RFC 7591 Dynamic Client Registration against ORC and prints an
   `ORC_CLIENT_ID`. It registers a **public PKCE client** — there is no client
   secret to protect. Save the printed `registration_access_token` somewhere
   private if you'll ever need to update the client (e.g. add a redirect URL —
   RFC 7592); it manages only this registration, it grants no data access.

3. **Configure**:

   ```sh
   cp .env.example .env.local
   ```

   Fill in:
   - `ORC_CLIENT_ID` — from step 2.
   - `ORC_ENV_ID` — the environment (Odoo instance) this app is pinned to.
     Find it with `orc envs` (the `ID` column), or ask your ORC admin.

4. **Run and log in**:

   ```sh
   npm run dev        # http://localhost:3001
   ```

   Click **Log in with ORC**. You'll authenticate on ORC (your existing
   session or Google SSO — this app never sees credentials), then ORC shows
   the **consent screen**: which app is asking, what it wants, and the
   environment picker with this app's environment pre-checked. Allow → you're
   back, with a table of that environment's recent Sales Orders.

## Deploy to Vercel — no Git required

Every `vercel` deploy is an immutable, rollback-able version; a Git
integration is optional sugar.

```sh
npm i -g vercel
vercel            # first run creates/links the project, deploys a preview
vercel --prod     # production deploy
```

Then wire production up:

1. Note the stable production URL: `https://<project>.vercel.app`.
2. Add it to your OAuth client's redirect URLs — either re-register with both:

   ```sh
   APP_URL=http://localhost:3001 \
   EXTRA_REDIRECT_URLS=https://<project>.vercel.app \
   npm run register-client
   ```

   (or PATCH the existing client at its `registration_client_uri` using the
   saved `registration_access_token` — RFC 7592.)
3. Set the four env vars on the Vercel project (dashboard or `vercel env add`):
   `ORC_URL`, `ORC_CLIENT_ID`, `ORC_ENV_ID`, and
   `APP_URL=https://<project>.vercel.app`.
4. `vercel --prod` again to pick them up. Share the URL — every colleague logs
   in as **themselves** and sees what *their* permissions allow.

> **If the ORC deployment enforces a redirect-host allowlist** (recommended for
> production ORCs), ask the ORC operator to allow your app's exact domain
> (`<project>.vercel.app`). Never expect `*.vercel.app` to be allowed — it's a
> shared hosting zone, anyone can deploy there.

> **Preview deployments** get per-deploy URLs that were never registered as
> redirect URLs — log in on the production URL (or register a preview URL
> explicitly if you need it).

## Make it your own

The demo is deliberately one query + one table. To adapt it:

- **Change the environment** — set `ORC_ENV_ID` to any environment you can
  reach (`orc envs`). The login route pre-selects it on the consent screen
  (`envs` parameter in [`app/api/auth/login/route.ts`](app/api/auth/login/route.ts)).
- **Change the data** — [`lib/orc.ts`](lib/orc.ts) → `fetchSalesOrders` is a
  single `orc_call_tool` invocation of Odoo's `odoo_search_read`. Change the
  `model` / `fields` / `domain` / `order`, or add more functions alongside it.
  Discover what tools an environment's namespace offers:

  ```sh
  orc odoo --env '<Org>/<env>' list                 # tool catalog
  orc odoo --env '<Org>/<env>' describe odoo_search_read   # arg schema
  ```

  Namespaces beyond `odoo` (github, jira, …) work the same way through
  `orcCallTool(token, '<namespace>', '<tool>', {...})` — subject to the user's
  persona and the environment grant.
- **Write data** — use `odoo_create` / `odoo_write` via the same
  `orc_call_tool`. Wire writes to explicit user actions only; whether a given
  user *may* write is decided by ORC (their persona), not by your code.
- **Change the UI** — [`app/page.tsx`](app/page.tsx) +
  [`app/sales-orders.tsx`](app/sales-orders.tsx), intentionally plain React,
  no UI framework.
- **Rename the app** — `CLIENT_NAME` at registration is what users see on the
  consent screen; pick something honest.

## Auth & session details (what the code actually does)

- **PKCE public client** — no client secret exists; the code exchange is bound
  to a per-login verifier ([`app/api/auth/login`](app/api/auth/login/route.ts) /
  [`callback`](app/api/auth/callback/route.ts)).
- **Tokens live in an HttpOnly cookie** — page JavaScript can never read them;
  only this app's backend forwards the access token to ORC.
- **Access token ~1 h; refresh token ~30 d, rotating** — after every refresh
  the *new* refresh token must be persisted (the `/api/sales-orders` route
  re-sets the cookie; see `ensureFreshTokens` in [`lib/orc.ts`](lib/orc.ts)).
  Concurrent refreshes can race the rotation; losing the race just means one
  extra login.
- **`offline_access` is a choice** — drop it from `OAUTH_SCOPE` in
  [`lib/config.ts`](lib/config.ts) and the app holds only 1-hour tokens (users
  re-login via a silent redirect roughly hourly). Keep it for daily-use apps.
- **Logout revokes** — [`app/api/auth/logout`](app/api/auth/logout/route.ts)
  best-effort revokes the refresh token at ORC (RFC 7009) and clears the cookie.
- **Two authorize-request rules** (learned against a live ORC — don't remove):
  `resource=https://<orc-host>/mcp` is **required** (binds the token to the
  right tenant host), and an `audience` parameter must **not** be sent (the
  server rejects it for DCR clients; ORC grants the audience itself).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `unauthorized_client … redirect address is not allowed` at login | The ORC deployment enforces a redirect-host allowlist and your domain isn't on it — ask the ORC operator to add the app's exact host. |
| `this app was not granted access to this environment` | The user consented to different environment(s) than `ORC_ENV_ID`. Log out, log in again, and select the right environment on the consent screen. |
| `OAuth state mismatch` after login | The 10-minute login window expired or cookies were blocked mid-flow — just click **Log in** again. |
| Table shows `Could not load orders: …` | The message is ORC's real cause: persona denies the tool, the user holds no usable key on that environment, or Odoo itself errored. It's per-user — another user may succeed. |
| Session expires ~hourly | `offline_access` was removed from `OAUTH_SCOPE`, or the refresh-token rotation raced; log in again. |
| Hydration warning about `<body>` attributes in dev | A browser extension (ColorZilla et al.) stamping the DOM — already suppressed on `<body>`; harmless. |
| Redirect lands on `/?error=token exchange failed (400)…` | Usually `redirect_uri` mismatch: `APP_URL` must exactly match a registered redirect base (scheme, host, port). |

## Files

| File | Role |
|---|---|
| `scripts/register-client.mjs` | one-shot Dynamic Client Registration (RFC 7591) |
| `lib/config.ts` | env-driven config (ORC URL, client id, env UUID, scopes) |
| `lib/cookies.ts` | HttpOnly cookie plumbing (OAuth transient + token set) |
| `lib/orc.ts` | rotation-aware token refresh + `/mcp` JSON-RPC + the Odoo query |
| `app/api/auth/login` | starts authorization-code + PKCE (+ env pre-selection) |
| `app/api/auth/callback` | state check + code→token exchange |
| `app/api/auth/logout` | revoke + clear |
| `app/api/sales-orders` | the data endpoint (refresh → `orc_call_tool`) |
| `app/page.tsx`, `app/sales-orders.tsx` | minimal UI |

## Security notes for forks

- Nothing in this repo is secret by design: the client id is a *public* OAuth
  client identifier, and `.env.local` (your actual config) is gitignored.
  Keep the `registration_access_token` from registration out of the repo — it
  can modify your client registration.
- Treat every deployed copy as an app your colleagues must *choose* to trust:
  the consent screen names it, scopes it, and environment-limits it — that's
  the contract. Don't work around it.
