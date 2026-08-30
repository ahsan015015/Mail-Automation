# Mail Automation

Self-hosted email automation: audiences, segments, templates with merge tags, broadcast + drip
campaigns, tracked sending and live analytics — in one Node process with one SQLite file.

No Redis, no Postgres, no queue workers, no third-party trackers. Point it at your own SMTP relay,
or run it with the built-in mail catcher and it works end to end with zero credentials.

---

## Try it in 30 seconds

```bash
npm install
cp .env.example .env          # everything has a sane default; you can leave it empty
npm run build && npm start    # http://127.0.0.1:8787
```

With `SEED_DEMO=1` (the default in `.env.example`) the first boot creates a demo workspace:
33 contacts, 3 lists, 6 templates and 4 campaigns (one completed broadcast, one running drip, one
scheduled broadcast, one draft) plus a delivery history, so every screen has something to show.
The first admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (defaults `admin@maillocal.dev` /
`change-me-please`). If you unset both, the app renders a **create-your-workspace** form instead.

For development (Vite HMR on 5173, API on 8787, `/api` proxied):

```bash
npm run dev
```

| Page | What lives there |
| --- | --- |
| **Dashboard** | KPIs, hourly sends/opens/clicks, funnel for the busiest campaign, list growth, live event feed, engine controls (run a tick, flush the outbox) |
| **Campaigns** | Broadcasts and drip sequences with progress, status filters, search, start / schedule / pause / resume / retry-failures / duplicate / cancel |
| **New campaign** | Three-tab builder: audience (segment + live estimate), content (multi-step editor with preview and test send), sending (rate cap, daily cap, window, weekends, tracking) |
| **Campaign detail** | Overview stats, per-step content editing while running, delivery log per contact, activity timeline, per-campaign pacing/tracking overrides |
| **Contacts** | Filterable audience, CSV import (paste or file) and export, bulk delete / add-to-list, contact drawer with merge fields, lists, tags and history |
| **Lists & tags** | Lists with member management, rotateable public subscribe URLs, tags with colours |
| **Templates** | Reusable subject/preheader/HTML with sanitising, merge-tag help, live personalisation preview, test send |
| **Inbox** | The mail catcher: every captured message rendered, as source, and with its real headers — plus "simulate an open" |
| **Settings** | Sender identity, global pacing and retries, SMTP credentials + connection test, tracking defaults |

## What it actually does

* **Audiences.** Lists are the legal boundary (one unsubscribe per list), tags are free-form labels.
  A campaign targets a segment: include lists, include tags (`any`/`all`), statuses, minus excluded
  lists/tags. The builder estimates the audience before you commit.
* **Content.** Templates and campaign steps use `{{merge}}` tags with fallbacks
  (`{{ first_name | there }}`), plus `{{#if company}}…{{else}}…{{/if}}` and `{{#unless …}}`.
  HTML is sanitised on save (tags, scripts and inline handlers removed); a plain-text alternative is
  generated from the HTML when you leave it empty.
* **Sending.** Starting a campaign only *queues* rows in `sends`. A single tick loop (default 1 s)
  flips due `scheduled` campaigns to `running`, claims due queue rows, and enforces a shared
  per-minute rate, a daily cap, per-campaign overrides, a local sending window and optional weekend
  skipping. Transient failures retry with exponential backoff (`backoffBaseSeconds × 2^attempts`);
  a 5xx/`EENVELOPE` response marks the send `bounced` and suppresses the contact.
* **Drip sequences.** Each step carries a delay (minutes/hours/days) from the previous step, and can
  be skipped for contacts who already opened or clicked.
* **Tracking.** An open pixel (1×1 GIF, never errors, 200 with an empty image), link redirects
  (`/t/c/<token>`) that also backfill a missing open, a signed one-click unsubscribe page
  (`/t/u/<token>` with a confirm form *and* RFC 8058 `List-Unsubscribe-Post`), and a preference
  centre for resubscribing (`/t/p/<token>`). Tokens are HMAC-signed, so nothing is enumerable.
* **Live UI.** The dashboard and lists subscribe to `GET /api/stream` (SSE) and refetch on every
  event, so numbers move while mail is going out.
* **Local mail catcher.** With `MAIL_TRANSPORT=memory` (or `auto` and no SMTP host) every message is
  rendered exactly as it would be sent, stored in the DB *and* written as an `.eml` file to `MAIL_DIR`.
  Links, pixel and unsubscribe routes all still work — which is why the whole product is demoable,
  testable and screenshot-able offline.

## Configuration

All environment variables are optional; see `.env.example` for the annotated list.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | HTTP bind |
| `PUBLIC_BASE_URL` | *derived per request* | Absolute base for tracking links. Set it behind a proxy, or leave empty to follow the `Host`/`X-Forwarded-Host` |
| `SESSION_SECRET` | dev-only string | Signs the session JWT — **change this** |
| `TRACKING_SECRET` | derived from `SESSION_SECRET` | Separate secret for pixel/click/unsubscribe HMACs |
| `DB_PATH` | `var/mail-automation.db` | SQLite file (created and migrated on boot) |
| `MAIL_DIR` | `var/mail` | Where `.eml` copies are written |
| `MAIL_TRANSPORT` | `auto` | `auto` \| `smtp` \| `memory` |
| `SMTP_HOST/PORT/SECURE/USER/PASSWORD` | – | Your relay. Prefer setting these in the UI (`Settings → Transport`) so they live in the DB, not in the environment |
| `FROM_NAME/FROM_EMAIL/REPLY_TO` | `Mail Automation` / `noreply@example.com` | Defaults for new campaigns |
| `SEND_RATE_PER_MINUTE` / `SEND_DAILY_CAP` | `30` / `2000` | Global pacing |
| `SEND_MAX_ATTEMPTS` / `SEND_BACKOFF_BASE_SECONDS` | `4` / `30` | Retry policy |
| `SEND_WINDOW_START/END_HOUR`, `SEND_SKIP_WEEKENDS` | off | Quiet hours |
| `TRACK_OPENS` / `TRACK_CLICKS` / `INCLUDE_UNSUB` | on | Tracking defaults |
| `SEED_DEMO` | `0` | Create the demo workspace on first boot |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@maillocal.dev` / `change-me-please` | Bootstrap owner (only when there are no users) |
| `WORKSPACE_NAME` | `Mail Automation` | Shown in the sidebar and page title |
| `ENGINE_TICK_MS` / `LOG_LEVEL` / `TZ_NAME` | `1000` / `info` / system | Engine cadence, logging, display timezone |

Runtime settings (sender identity, SMTP, pacing, tracking) live in the database and are edited on
`Settings → `; the environment only provides defaults. The SMTP password is never returned by the
API — `GET /api/settings` reports `smtp.hasPassword` instead.

## Docker

```bash
docker build -t mail-automation .
docker run --rm -p 8787:8787 -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v $PWD/data:/app/var mail-automation
```

The image is `node:22-slim` (Node ≥ 22.5 is required — the app uses the built-in `node:sqlite`), has
no native dependencies to compile, and runs the same single process. `var/` holds the database and the
captured mail, so mount it as a volume. Health is checked against `/api/health`.

To send real mail, set `MAIL_TRANSPORT=smtp` and the `SMTP_*` variables — or configure the relay in
the UI after the first boot.

## Architecture

```
src/
├─ shared/types.ts        every DTO, shared by both sides (no runtime imports)
├─ server/
│  ├─ lib/                config · dotenv · validation (zod) · merge tags · html sanitiser
│  │                      csv · jwt · password · tokens · page · util · log · public-origin
│  ├─ db/                 schema (migrations) · sqlite wrapper · demo seed (idempotent)
│  ├─ services/           contacts · lists · templates · campaigns (queue) · engine (worker)
│  │                      mailer (transports) · render · events (bus) · stats · mailbox · settings · auth
│  ├─ routes/             auth · audience · templates · campaigns · tracking · workspace
│  ├─ middleware.ts       wrap · requireAuth · zod/HttpError → JSON problems
│  ├─ app.ts              express 5 app: security headers, routers, SPA fallback
│  └─ index.ts            boot: migrations → admin → seed → listen → engine.start()
└─ client/
   ├─ lib/                 api (typed fetch) · hooks (useAsync/useLiveStream/useDebounced/toasts) · format
   ├─ components/         ui (design-system primitives) · Charts (SVG, dependency-free) · Editor
   │                       Icons (inline SVG) · Layout (shell) · SegmentEditor · SendsTable
   └─ pages/              Login · Dashboard · Campaigns · NewCampaign · CampaignDetail
                          · Contacts · Lists · Templates · Inbox · Settings
```

The `sends` table is both the queue and the delivery log (`queued → sending → sent/failed/bounced/
skipped`, one row per step × contact, `UNIQUE(step_id, contact_id)`). Everything else derives from it,
which is why the app needs no separate queue service.

### HTTP surface

`GET /api/health` and `GET /api/bootstrap` are public; every other `/api/*` route needs the `ma_session`
cookie (HS256 JWT, HttpOnly, SameSite=Lax, 30-day). `POST /api/auth/setup` only works while the `users`
table is empty. Recipient-facing `/t/*` routes are unauthenticated by design and signed instead.

```
POST /api/auth/login · POST /api/auth/logout · GET /api/auth/me · POST /api/auth/setup
GET  /api/lists · POST /api/lists · PATCH|DELETE /api/lists/:id · GET /api/lists/:id/contacts
POST /api/lists/:id/members · DELETE /api/lists/:id/members/:contactId · POST /api/lists/:id/regenerate-token
GET|POST|DELETE /api/tags · GET /api/contacts(±filters) · POST /api/contacts · GET|PATCH|DELETE /api/contacts/:id
POST /api/contacts/import · POST /api/contacts/bulk-delete · GET /api/contacts/export (CSV)
POST /api/contacts/:id/unsubscribe|resubscribe · GET /api/contacts/:id/events · GET /api/contacts/fields
GET|POST /api/templates · GET|PATCH|DELETE /api/templates/:id · POST /api/templates/preview
POST /api/templates/:id/duplicate|test
GET|POST /api/campaigns · POST /api/campaigns/estimate · GET|PATCH|DELETE /api/campaigns/:id
POST /api/campaigns/:id/start|pause|resume|cancel|retry-failed|validate|duplicate|send-test
POST|PATCH|DELETE /api/campaigns/:id/steps[/:stepId] · POST /api/campaigns/:id/steps/:stepId/move
GET  /api/campaigns/:id/stats|series|sends|events|funnel
GET|PUT /api/settings · POST /api/settings/smtp/test
GET  /api/stats/dashboard|growth|campaigns/:id|contacts · GET /api/activity · GET /api/stream (SSE)
GET|DELETE /api/mailbox(±/:id) · GET /api/mailbox/:id/raw · POST /api/mailbox/:id/simulate-open
GET|POST /api/engine/tick · GET /api/engine
GET  /t/o/:token · GET /t/c/:token · GET|POST /t/u/:token · GET|POST /t/p/:token · GET|POST /t/lists/:token
```

## Tests

```bash
npm test           # 92 tests: unit (merge tags, CSV, HTML sanitiser, tokens) + integration
npm run typecheck  # client (strict) and server (NodeNext) separately
```

The integration suites boot the real Express app against a temp SQLite file and the memory transport,
drive campaigns through the engine, then assert on pixels, click redirects, unsubscribe, rate caps,
daily caps, sending windows, retries/bounces, settings validation and the live stream.
`tests/client-smoke.test.tsx` additionally renders all ten pages of the React app (happy-dom) against
that same live server and performs two writes through the UI, so the client cannot silently drift from
the API.

## Notes & limitations (deliberate)

* Single-process, single-node by design — one SQLite file. For very large lists run one instance,
  or shard workspaces by database file.
* No public HTML WYSIWYG editor: paste HTML, edit it in the code editor, preview it in a sandboxed
  frame. The editor shows unresolved merge tags and risky markup before you send.
* Open tracking is pixel-based (unreliable for privacy-preserving clients) — click and bounce data are
  the honest signals.
* DKIM/SPF, dedicated IPs, bounce-mailbox parsing (DSNs) and A/B tests are out of scope: the app
  records what the SMTP server reports (including 5xx hard bounces) rather than reading a mailbox.
* The `.env`-provided SMTP password is only a bootstrap default; store real credentials in the UI so
  they stay out of your deployment config.
