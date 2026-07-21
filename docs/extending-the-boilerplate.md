# Extending the boilerplate

The boilerplate is a **read-only Odoo app** by default. Real apps usually need two
more things: **their own persistence** (for data that has no home in Odoo) and a
handful of **operational patterns** that aren't obvious until you hit them.

These are findings from building a real app on top of this boilerplate
([`opsway/app-sales-opportunity-studio`](https://github.com/opsway/app-sales-opportunity-studio)
— an opportunity studio: Odoo via ORC for CRM/partners, Neon for its own
ideas/demos/solutions). Copy what you need.

---

## 1. Add a persistence layer (Neon Postgres)

Reach for this when the app has entities Odoo doesn't model (app-specific
records, curation, cross-references, workflow state). Keep Odoo the source of
truth for what already lives there; put the rest in Neon.

### Provision (Vercel-managed Neon)

Vercel dashboard → your project → **Storage → Create Database → Neon** → connect
to the project (**all environments**). It auto-injects a bundle of env vars —
`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`,
`POSTGRES_URL_NON_POOLING`, `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`,
`NEON_*`. No manual copying needed for deploys.

### Client

```sh
npm i @neondatabase/serverless
```

```ts
import { neon } from '@neondatabase/serverless';
const sql = neon(dbUrl());

// Parameterized query — use .query() (see the first gotcha below):
const rows = await sql.query('SELECT * FROM ideas WHERE stage = $1', ['sold']);
```

Three things that will bite you:

- **Use `sql.query(text, params)` for placeholder queries** (or the
  tagged-template `` sql`...` ``). Current `@neondatabase/serverless` versions
  *disable* the bare `sql(text, params)` call form as a SQL-injection foot-gun —
  it throws at runtime: *"can now be called only as a tagged-template function …
  use sql.query(…)"*. `.query()` returns the rows array directly (same shape as
  node-postgres' `.rows`). This bites **only in production** if you develop
  locally against a different driver (see next bullet) — it never shows up in
  `tsc` or local dev.
- **The HTTP driver talks to Neon only.** It won't connect to a local/Docker
  Postgres. For offline local dev, swap drivers by connection string — use
  node-postgres (`pg.Pool`) against a Docker Postgres locally and `neon()` on
  Vercel, both behind one `sql(text, params)` helper that returns rows the same
  way. That avoids needing a real Neon URL just to run locally, and is why the
  `.query()` mismatch above only surfaces in prod. (Alternatively, run the
  `neondatabase/neon_local` proxy so the serverless driver itself works locally.)
- **One statement per call.** No multi-statement scripts — keep DDL as a list of
  `CREATE TABLE IF NOT EXISTS` statements and run them in sequence.

Read the URL with fallbacks, so whatever Vercel injected works:

```ts
function dbUrl(): string {
  const u =
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!u) throw new Error('Missing DATABASE_URL (attach Neon in Vercel → Storage)');
  return u;
}
```

### Schema + seed, idempotently (no migration tool)

Memoize a one-time "ready" promise; every route awaits it. Runs at most once per
warm serverless instance, and `IF NOT EXISTS` makes it safe to run repeatedly.

```ts
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ideas ( id SERIAL PRIMARY KEY, title TEXT NOT NULL, ... )`,
  `CREATE TABLE IF NOT EXISTS ... `,
];
let ready: Promise<void> | null = null;
export function ensureReady() {
  if (!ready) ready = (async () => {
    for (const ddl of SCHEMA) await sql(ddl);   // one statement per call
    // ...seed reference data only if empty...
  })();
  return ready;
}
```

Add a tiny public health route so a plain `curl` proves the DB is reachable +
initialized: `GET /api/health` → `ensureReady()` then return a couple of counts.

### ⚠️ The local-dev gotcha (this one costs an hour if you don't know it)

The Vercel↔Neon integration marks its env vars **Sensitive**. `vercel env pull`
**cannot retrieve Sensitive values** — it writes the literal placeholder
`"[SENSITIVE]"`. So a pulled `.env.local` contains `DATABASE_URL="[SENSITIVE]"`,
and the app fails locally with *“Database connection string … is not a valid
URL.”* — while **production is fine**, because it reads the real value
server-side.

- **Tell:** if your local `DATABASE_URL` is 11 chars and starts with `[`, it's
  the placeholder, not your database.
- **Fix:** paste the real connection string into `.env.local` yourself — Vercel →
  Storage → your Neon store → *`.env.local`* tab / “Show secret”, or the Neon
  console. Same applies to *any* var you mark Sensitive (incl. ones you add).

---

## 2. Make `APP_URL` survive a Vercel build

`lib/config.ts` reads `APP_URL` via `required()` at module load. Vercel imports
your route modules at **build** time to collect them — so if you deploy before
setting `APP_URL`, the build fails with a cryptic *“Failed to collect page data
for /api/auth/callback.”*

Fall back to Vercel's **stable production domain** so a deploy never needs an
explicit `APP_URL` and the OAuth redirect still matches a registered URL:

```ts
export const APP_URL =
  process.env.APP_URL?.trim().replace(/\/+$/, '') ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : (() => { throw new Error('Missing APP_URL and no VERCEL_PROJECT_PRODUCTION_URL'); })());
```

Use `VERCEL_PROJECT_PRODUCTION_URL` (stable) — **not** `VERCEL_URL` (per-deploy),
which changes every deploy and would never match the registered redirect.

---

## 3. Odoo call recipes

### Always pass `intent`

Every `odoo_*` tool takes a **required `intent`** string (min 5 chars) — a
one-line plain-English statement shown to the user in ORC's activity log and used
as a forcing function that measurably reduces wrong-arg calls. The demo's
`fetchSalesOrders` omits it (it still works), but real apps should include it on
every call:

```ts
await orcCallTool(token, 'odoo', 'odoo_search_read', {
  intent: 'Listing recent sale orders for the dashboard.',
  model: 'sale.order', fields: [...], limit: 25,
});
```

### Forgiving entity search (name OR email → commercial company)

A naive `name ilike 'pg'` misses punctuation-heavy legal names like
`"P.G. Group Sp. z o.o"` (lower-cased it has no `pg` substring). Search **name OR
email**, then roll each hit up to its `commercial_partner_id` and dedupe — so a
search by an email-domain fragment finds the account, and you offer the *company*
rather than individual contacts:

```ts
domain: query ? ['|', ['name','ilike',query], ['email','ilike',query]]
              : [['is_company','=',true]],
fields: ['id','name','is_company','commercial_partner_id','commercial_company_name'],
// then: accountId = commercial_partner_id?.[0] ?? id; dedupe by accountId.
```

### Writes

`odoo_create` / `odoo_write` go through the same `orc_call_tool`. Wire them to
explicit user gestures only; whether the user *may* write is ORC's persona
decision, not your code's. Treat a transient error on a write as
outcome-unknown — re-read before re-firing.

---

## 4. Who is the logged-in user?

ORC gates sign-in and persona-gates every call, but your app often needs a
**local identity** (owner defaults, per-user rows, roles). The access token can
be opaque or lack an email, so don't assume you can read one:

- Best-effort: decode JWT claims (`sub`, `ext.email`); or call OIDC
  `/userinfo` — but that needs the `openid` scope, which this boilerplate does
  **not** request (`OAUTH_SCOPE = 'mcp offline_access'`).
- To get a reliable email, add `openid email` to `OAUTH_SCOPE`, re-register the
  client with those scopes, and read the returned **id_token**.
- For an internal tool where ORC already gates who can sign in, the simplest
  model is often: treat every authenticated user uniformly (e.g. all admins) and
  key per-user rows by the token `sub`. Don't build a role system you can't
  populate.

---

## 5. Small Next.js / Vercel gotchas

- **App Router ignores `_`-prefixed folders.** `app/api/_diag/route.ts` is
  *non-routable* (404). Name diagnostic/utility routes without the underscore.
- **Per-deploy URLs are protected.** `https://<project>-<hash>.vercel.app`
  returns a 302 to a Vercel login; only the **stable production alias** and your
  custom domains are public. Health-check the stable alias.
- **Env changes need a redeploy.** `vercel env add` doesn't affect the running
  deployment until you `vercel --prod` again.
- **Porting a legacy vanilla-JS SPA?** Drop it in `/public` and load it as a
  **classic script** (`<Script src="/app.js" strategy="afterInteractive" />`).
  Its top-level functions and inline `onclick=""` handlers then resolve as
  globals — so an imperative SPA moves over verbatim without rewriting every
  handler as a React event.

---

## 6. Custom domain + Cloudflare (recap of the README's allowlist note)

- DNS: `*.app.opsway.com` (or a single host) → `cname.vercel-dns.com`, **DNS only
  (grey cloud)**. Cloudflare won't proxy a wildcard off Enterprise anyway, and
  Vercel must terminate TLS.
- Add the domain to the Vercel project; for a wildcard cert, add the TXT record
  Vercel shows.
- Add the callback to the **existing** OAuth client via the RFC 7592 PATCH (see
  the README) — never re-run the registration script, which mints a new client
  id and forces every user to re-consent.
