# SWB EU Withdrawal

A Shopify app for the EU right-of-withdrawal workflow (Directive (EU) 2023/2673, in force since 19 June 2026):

- a **storefront withdrawal form** that guests can use without logging in,
- a **two-step submission** (review page, then explicit confirmation) that issues a unique reference number,
- **email confirmations** to the customer and **notifications** to the merchant,
- an **embedded admin app** with dashboard, request inbox, archive, CSV export, notes and an audited status workflow,
- a **no-code Form Builder** built on predefined fields, with versioned publishing.

> **Legal note.** This app provides workflow tools. It does not guarantee legal compliance. Withdrawal periods,
> exceptions and wording depend on the merchant, the contract, the product and the customer's country. Have the setup
> reviewed by qualified counsel. A withdrawal request is not an approved return or a processed refund, and the app never
> refunds or cancels orders.

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Official Shopify app template for React Router 7 (`@shopify/shopify-app-react-router`), TypeScript |
| Admin UI | Polaris web components (`s-*`) + App Bridge, React 19 |
| Database | **MySQL 8** with Prisma 6 |
| Validation | Zod (form schemas, settings), custom server-side submission validator |
| Storefront | Theme app extension (app block + app embed) + **app proxy** (`/apps/withdraw`) |
| Email | Provider abstraction: `log` (dev), `smtp` (nodemailer), `resend` (HTTP API) |
| Tests | Vitest: unit tests + integration tests against a real MySQL test database |

**Why React 19:** the template ships React 18, which does not forward `change` events from custom elements. React 19
supports custom elements natively, so `onChange` and `onInput` on Polaris web components work reliably.

## Architecture

```
app/
  routes/
    app.tsx                      Embedded admin shell + left navigation
    app._index.tsx               Overview (summary cards, recent requests, setup checklist)
    app.withdrawals._index.tsx   Inbox (search/filter/pagination/export)
    app.withdrawals.$id.tsx      Request detail (answers, status, notes, history, email log)
    app.withdrawals.export.tsx   CSV export (authenticated resource route)
    app.archive.tsx              Archived requests
    app.form-builder.tsx         No-code form builder + preview + versioning
    app.emails.tsx               Email templates, preview, test send, delivery log
    app.settings.tsx             Settings, optional scopes, privacy data requests
    app.help.tsx                 Setup guide + theme editor deep links (+ dev sample data)
    proxy.tsx                    Customer-facing form via app proxy (form → review → confirm)
    webhooks.compliance.tsx      customers/data_request, customers/redact, shop/redact
    webhooks.app.*.tsx           app/uninstalled, app/scopes_update
    api.jobs.tsx                 Optional external trigger for background jobs
  models/                        Domain services; every query is scoped by shopId
  lib/                           Pure helpers (schema, validation, rendering, CSV, i18n, signing, time zones)
  services/email-provider.server.ts
  jobs.server.ts                 Email retries, rate-limit cleanup, retention purge
extensions/withdrawal-button/    Theme app extension (app block, app embed, snippet, CSS)
prisma/schema.prisma             MySQL schema + migrations
tests/                           unit/ and integration/
```

### Key design decisions

- **Customer form through the app proxy.** `https://{shop}/apps/withdraw` is proxied to `/proxy`, so the form appears
  on the store's own domain inside the theme layout (`Content-Type: application/liquid`). Shopify signs every proxied
  request, and the app verifies that signature.
- **Stateless two-step flow.** App proxies strip cookies, so the review step stores its state in an HMAC-signed hidden
  field. On confirmation the server re-verifies the signature, re-validates every answer against the form version, and
  only then writes to the database.
- **Exactly-once submission.** Each form session carries a random nonce, which becomes a unique `(shopId,
  idempotencyKey)`. Double clicks, refreshes and concurrent duplicates all return the original request.
- **Immutable form versions.** Publishing creates a `FormVersion` snapshot. Each request references its version and
  stores one `WithdrawalAnswer` per field with the label as it was at submission time. Later edits never change history.
- **Transactional email outbox.** Email rows are written in the same transaction as the request, with a unique
  `dedupeKey`. Workers claim rows atomically, failures back off (1 min → 12 h) and become `DEAD` after 6 attempts, and
  merchants can retry from the UI. Resend receives an `Idempotency-Key`.
- **Liquid-safe rendering.** Every dynamic value in storefront HTML is HTML-escaped and has `{`/`}` encoded, so neither
  merchants nor customers can inject markup, script or Liquid. Only the app's own constant CSS/JS sit in `{% raw %}`.

## Shopify configuration

### Access scopes (least privilege)

No scopes are required at install (`scopes = ""`). Two **optional scopes** are requested at runtime, only when the
merchant turns on the matching feature in Settings:

| Scope | Used for | API |
| --- | --- | --- |
| `read_orders` | Optional order verification (order number + email) | `orders(query: "name:…")` |
| `write_orders` | Optional order tagging (off by default) | `tagsAdd` |

The `shop { name email ianaTimezone currencyCode }` query and the app-owned metafield (`metafieldsSet` on
`currentAppInstallation`) need no scopes. If a scope is revoked, `app/scopes_update` turns the feature off. Orders
older than 60 days would need `read_all_orders`, which the app does not request, so such requests are marked "not
matched" rather than verified. Order data is **protected customer data**: before a production App Store release, apply
for access in the Partner Dashboard.

### Webhooks

Declared in `shopify.app.toml` (API version `2026-10`):

- `app/uninstalled`: deletes sessions and marks the shop uninstalled. Data is kept until `shop/redact`.
- `app/scopes_update`: stores granted scopes and disables features whose scope was revoked.
- `customers/data_request`: collects the customer's requests; the merchant downloads them as JSON in Settings.
- `customers/redact`: deletes the customer's requests (matched by email, customer ID or order IDs).
- `shop/redact`: deletes all of the shop's data.

`authenticate.webhook` verifies the HMAC and returns `401` on failure. Compliance webhooks are de-duplicated by
`X-Shopify-Webhook-Id`, and a failed handler returns `500` so Shopify retries.

### Theme app extension

`extensions/withdrawal-button` provides:

- **App block "Withdrawal button"**: add it to any section (footer, contact page, …). Settings: label, text, style,
  alignment, colors, "only show for EU/EEA countries".
- **App embed "Floating withdrawal button"**: shown on every page, bottom-left or bottom-right.

Empty block settings fall back to the defaults from the app's Settings page, which are stored in the app-owned metafield
`app.metafields.swb.button`. The EU-only option uses the visitor's selected country/market (`localization.country`),
not IP geolocation. Apps cannot edit themes automatically, so merchants enable the block or embed in the theme editor.
The Help page has deep links for this.

## Local development

### Prerequisites

- Node.js ≥ 22.12 (tested with Node 24) and npm
- Docker (for MySQL), or a local MySQL 8 server
- Shopify CLI 3.x+ (tested with 4.3) and a Shopify Partner account with a **development store**

### Setup

```bash
npm install
cp .env.example .env                  # then set APP_SIGNING_SECRET (openssl rand -hex 32)
npm run db:up                         # MySQL 8 on localhost:3307 (dev + test databases)
npx prisma migrate deploy             # apply migrations to the dev database
npm run config:link                   # link to (or create) your app in the Partner/Dev Dashboard
npm run dev                           # shopify app dev: tunnel, install on dev store, extension preview
```

`shopify app dev` fills in `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` and `SHOPIFY_APP_URL` and updates the app proxy and
redirect URLs while it runs (`automatically_update_urls_on_dev = true`).

Then, on the development store:

1. Open the app → **Form Builder** → review the default template → **Publish** (the default is pre-published on install).
2. Open `https://<your-store>.myshopify.com/apps/withdraw` (enter the storefront password first on password-protected
   dev stores).
3. Add the button in the theme editor (see **Documentation / Help** in the app).
4. Optional: **Help → Create sample requests** fills the inbox with demo data (development only; no emails are sent).

### Environment variables

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | Shopify app credentials (set by the CLI in dev) |
| `DATABASE_URL` | MySQL connection string |
| `TEST_DATABASE_URL` | Separate MySQL database for `npm test`. The test suite refuses to run unless the database name contains "test" |
| `APP_SIGNING_SECRET` | ≥ 16 characters; signs storefront form tokens and hashes IPs for rate limiting |
| `EMAIL_PROVIDER` | `log` (default, dev only), `smtp` or `resend` |
| `EMAIL_FROM` | Sender, e.g. `Withdrawals <withdrawals@yourdomain.com>` (must be a verified sender) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | SMTP settings |
| `RESEND_API_KEY` | Resend API key |
| `RUN_JOBS_IN_PROCESS` | `true` (default) runs email retries and maintenance inside the web process |
| `JOBS_SECRET` | Bearer token for `POST /api/jobs` when jobs are triggered externally |

With `EMAIL_PROVIDER=log`, emails are recorded as sent and summarised in the server console but **not delivered**. The
Email Editor shows a warning banner in this mode.

## Testing and checks

```bash
npm run db:up        # MySQL must be running
npm test             # unit + integration tests (applies migrations to the test DB)
npm run lint
npm run typecheck
npm run build
npm run check        # all of the above
shopify theme check --path extensions/withdrawal-button
```

The integration tests run against the real MySQL test database. They cover:

- shop isolation and IDOR protection for requests, forms, emails and privacy exports
- the full storefront flow through the proxy route, with real Shopify signatures: form → review → confirm
- invalid signatures, tampered review payloads, malicious input, the honeypot, the minimum fill time and rate limiting
- duplicate and concurrent submissions
- form versioning (save, publish, unpublish, restore, reset) and answer snapshots
- dashboard counts across time zones, filters, the audit trail, notes, archive/restore and retention purge
- email outbox: exactly-once delivery under concurrent workers, escaping, backoff, dead-lettering, manual retry
- compliance webhooks with real HMAC validation, idempotency and deletion scope

## Production deployment

1. Provision **MySQL 8** (utf8mb4) and set `DATABASE_URL`.
2. Set all environment variables. Use a dedicated `APP_SIGNING_SECRET` and a real email provider with a verified
   sender domain (SPF/DKIM).
3. Build and run: `npm ci && npm run build && npm run setup && npm run start`, or use the included `Dockerfile`
   (`npm run docker-start` runs `prisma migrate deploy` before starting).
4. Running more than one instance: set `RUN_JOBS_IN_PROCESS=false` and call `POST /api/jobs` every minute with
   `Authorization: Bearer $JOBS_SECRET`.
5. `npm run deploy` (Shopify CLI) to push the app configuration, app proxy, webhooks and the theme extension.
6. App Store release: request protected customer data access (only needed if order lookup is offered), complete the
   privacy listing, and test install → uninstall → reinstall on a development store.

## Data stored and retention

- **Stored:** submitted answers (with label snapshots), customer name/email, order reference, verification result and
  order ID (only if verified), Shopify customer ID if logged in, timestamps, status history, internal notes, email
  content and delivery status.
- **Not stored:** IP addresses (only an HMAC of shop + IP for rate limiting, deleted after 24 h), payment data, or full
  submissions in application logs.
- Archived requests can be deleted automatically after N days (Settings → Data retention; off by default because
  merchants may have record-keeping obligations).
- `shop/redact` removes all of a shop's data; `customers/redact` removes the customer's requests.

## Security summary

- Admin: every loader/action calls `authenticate.admin` (App Bridge session tokens, which also prevents CSRF) and
  queries by `shopId` from the verified session.
- Storefront: app proxy signature verification; signed, expiring review tokens; server-side validation against the
  form version; honeypot, minimum fill time and per-visitor rate limit; `Cache-Control: no-store`.
- Output: HTML + Liquid escaping; no merchant HTML or script is ever executed; option values and colors are
  allow-listed; email subjects cannot contain line breaks; email variables are allow-listed.
- CSV: every cell is quoted and formula triggers (`= + - @`, tab, CR) are neutralised.
- Secrets come only from environment variables; `.env` is git-ignored and `.env.example` has no secrets.

## Known limitations

- **Single form per shop in the UI.** The data model supports several forms, but the builder edits the default form.
- **Merchant-entered labels are single-language.** Fixed UI strings are translated (en, de, fr, es, it, nl), and the
  theme button passes the storefront language as `?lang=`.
- **Theme placement detection.** The app cannot read the theme to confirm the button was added, so the merchant ticks
  this in the setup checklist. The app detects the first storefront visit to the form.
- **Staff attribution** uses the Shopify staff user ID from the session token ("Staff member (ID …)"). Names would need
  online tokens or extra scopes.
- **Order verification** only matches orders from the last 60 days (no `read_all_orders`).
- **Withdrawal-period hint** is computed from the order date. The legally relevant start is often delivery; the hint is
  informational and never blocks a request.
- **In-process jobs** suit a single instance. Use `/api/jobs` with an external scheduler for multiple instances.
- **Not yet verified on a live development store from this repository.** Automated tests exercise the routes directly;
  an end-to-end check with `shopify app dev` on a development store is still required (see Local development).
