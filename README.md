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

## Register the app (one OAuth client per app)

Every app needs its **own** OAuth client — that's the identity users see on the
consent screen ("_&lt;your app&gt;_ wants access…"), and grants are tracked
per client. **Don't share one client across two apps.**

There are two ways to register, depending on how the app's **environment** is
decided:

### Recommended for a single-purpose app — ORC's platform "Connected Apps"

If your ORC has the **Connected Apps** admin page, ask a platform admin to
register the app there. They set the app's name, redirect URIs, **and the
target environment(s)** — and that environment is then **fixed**: the consent
screen shows it read-only (users don't pick from their whole list, and can't
point the app at a different Odoo). They hand you the `ORC_CLIENT_ID`; set it
(and the matching `ORC_ENV_ID`) in your config and you're done. This is the
right model for an app that's *about* one Odoo instance.

### Self-serve — Dynamic Client Registration (generic/agent connectors)

For a connector that legitimately spans the user's whole catalog (claude.ai
style), or an ORC without the Connected Apps UI, use DCR — **self-serve**
(RFC 7591), no admin, no client secret; it produces a *public* PKCE client.
Here the **user** picks the environment at consent.

`scripts/register-client.mjs` does it in one call. **Register every URL the app
will ever be served from, up front** — local dev, the Vercel domain, and any
custom domain — so you never have to re-register (which would mint a new client
id and force every user to re-consent):

```sh
cd orc-vercel-boilerplate            # this repo — the script lives here
APP_URL=http://localhost:3001 \
EXTRA_REDIRECT_URLS=https://my-app.vercel.app,https://my-app.opsway.com \
CLIENT_NAME="My App" \
npm run register-client
```

- `APP_URL` — the primary base URL; the redirect becomes `<APP_URL>/api/auth/callback`.
- `EXTRA_REDIRECT_URLS` — comma-separated additional base URLs (each gets
  `/api/auth/callback` appended). Optional; use it to cover every host at once.
- `CLIENT_NAME` — what users see on the consent screen. Make it honest and
  specific (it's how someone tells your app apart from anyone else's).
- `ORC_URL` — defaults to `https://help.opsway.com`; set it for a different ORC.

It prints:

| Output | What to do with it |
|---|---|
| `ORC_CLIENT_ID` | put in `.env.local` (local) **and** the deployed project's env vars |
| `redirect_uris` | echo of what was registered — Hydra matches these **character-exact** |
| `registration_access_token` + `registration_client_uri` | **keep private** (not in the repo). They let you *update* this client later (RFC 7592) — e.g. add a redirect URL — without minting a new id |

**Adding a URL later** (a new custom domain) without a new client id — PATCH the
registration instead of re-running the script:

```sh
curl -X PATCH "$REGISTRATION_CLIENT_URI" \
  -H "Authorization: Bearer $REGISTRATION_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["https://my-app.vercel.app/api/auth/callback","https://my-app.opsway.com/api/auth/callback"]}'
```

> **Two failure modes to know.** (1) *`redirect_uri … does not match`* at login →
> the host you're serving from isn't among the registered `redirect_uris`
> (register it, exact match incl. scheme + port). (2) On an ORC that enforces a
> **redirect-host allowlist**, a registered URL can still be refused with
> *`unauthorized_client … redirect address is not allowed`* — the operator must
> allow the app's domain. A custom domain under a zone the org controls (e.g.
> `*.opsway.com`) is the durable fix: registered once, allowlisted once.

## Quickstart (local)

1. **Get the code** (clone, or copy the folder — nothing here is
   deployment-specific):

   ```sh
   git clone https://github.com/opsway/orc-vercel-boilerplate.git
   cd orc-vercel-boilerplate && npm install
   ```

2. **Register your OAuth client** — see [Register the app](#register-the-app-one-oauth-client-per-app)
   above. For a purely local start, the minimum is:

   ```sh
   APP_URL=http://localhost:3001 CLIENT_NAME="My Sales Orders app" npm run register-client
   ```

   Copy the printed `ORC_CLIENT_ID` for the next step. (Going to deploy? Register
   the Vercel + custom-domain URLs now too, via `EXTRA_REDIRECT_URLS` — one
   registration covers every host.)

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
   the **consent screen**, and what it looks like depends on how the app was
   registered:
   - **DCR client** (the `register-client.mjs` script above) → an environment
     **picker** with this app's env pre-checked but still changeable. This is
     correct for a generic connector, but it means the user *can* point the app
     at a different environment.
   - **Connected App** (registered by a platform admin — see
     [Register the app](#register-the-app-one-oauth-client-per-app)) → the
     environment is shown **read-only, no picker**: the app is locked to the
     environment it was registered for. **This is what you want for a
     single-purpose app.**

   Allow → you're back, with a table of that environment's recent Sales Orders.

## Deploy to Vercel — no Git required

Every `vercel` deploy is an immutable, rollback-able version; a Git
integration is optional sugar.

```sh
npm i -g vercel
vercel            # first run creates/links the project, deploys a preview
vercel --prod     # production deploy
```

> **Pick your callback domain BEFORE you deploy — read the allowlist note at
> the end of this section first.** On an ORC that enforces a redirect-host
> allowlist (e.g. `help.opsway.com`), a `*.vercel.app` URL cannot be used as a
> callback at all — you must serve the app from an org-controlled domain such as
> `*.app.opsway.com`. If that applies to you, substitute that host for
> `<project>.vercel.app` in every step below.

Then wire production up:

1. Note the stable production URL: `https://<project>.vercel.app` (or your
   org-controlled domain — see the callback note below).
2. Make sure that URL's callback is on the client's `redirect_uris`. If you
   registered it up front (recommended — see
   [Register the app](#register-the-app-one-oauth-client-per-app)), you're done.
   If not, add it to the **existing** client (keeps the same `ORC_CLIENT_ID`, no
   re-consent) via the RFC 7592 PATCH shown in that section — don't re-run the
   registration script, which mints a new client id.
3. Set the four env vars on the Vercel project (dashboard or `vercel env add`):
   `ORC_URL`, `ORC_CLIENT_ID`, `ORC_ENV_ID`, and
   `APP_URL=https://<project>.vercel.app`.
4. `vercel --prod` again to pick them up. Share the URL — every colleague logs
   in as **themselves** and sees what *their* permissions allow.

> **Callback domain — the allowlist is a hard requirement, not a maybe.**
> Production ORCs enforce a redirect-host allowlist. `*.vercel.app` is a shared
> hosting zone (anyone can deploy there), so it is **not** an acceptable callback
> host — and this is not fixable by asking the operator to allow your one
> `<project>.vercel.app` host. On `help.opsway.com` the callback must live under
> an **org-controlled zone** (e.g. `*.app.opsway.com`). So point such a host at
> the Vercel project, register `https://<host>/api/auth/callback`, and set
> `APP_URL` to it. A bare `*.vercel.app` deploy will build, register its
> redirect_uri, and even reach ORC's login screen — but the callback is rejected,
> so **login can never complete**. Decide the domain up front; moving it later
> means re-registering redirect URIs.

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

> **Building something real on top of this?** See
> [`docs/extending-the-boilerplate.md`](docs/extending-the-boilerplate.md) —
> adding a **Neon** persistence layer (and the Sensitive-env gotcha that breaks
> local dev), keeping `APP_URL` from failing the build, Odoo call recipes
> (`intent`, forgiving partner search, writes), resolving the logged-in user,
> and assorted Next.js/Vercel gotchas. Findings from a real app built on this.

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
| Consent shows the **full environment list** and I can pick others (even though one is pre-checked) | Your app is a **generic DCR client** (registered with `register-client.mjs`) — generic clients always get the picker. To lock it to a single environment (read-only, no picker), **register it as a Connected App** via ORC's platform admin instead; the admin sets the environment there and it becomes fixed. Then set `ORC_CLIENT_ID` to the new managed client. This is a *registration* change, not a code change — the boilerplate needs no extra hooks. |
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
