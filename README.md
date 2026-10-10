# Family Events OS — server foundation

Existing repository: https://github.com/andrianshneider/family-events-miniapp

One Next.js 16.4 / React / strict TypeScript application for Telegram Mini App, Web and PWA. Contract: [Technical Specification v1.0](https://docs.google.com/document/d/1HrYTqMQAW-82OZBLHN9VO3JrNzccGqR0QgHjMYiU39o/edit) and [PRD v1.0](https://docs.google.com/document/d/1fIecJjtJZKOtvpBx_uS6XVmKlwi6Fm-hUxmdbODAzRE/edit). Earlier architecture is superseded.

## Scope

Foundation: private PostgreSQL schema, sessions, Telegram verification/OIDC, DAL/transaction helpers, validation, Storage upload completion, notification worker, encrypted webhook inbox and CI. No product vertical slice is presented as complete. Existing root HTML and assets remain intact. `public/` contains unchanged copies of approved demo screens. `/` opens the existing login mockup; `/events` requires Organizer authentication but its target screen is still a demo. Its simulated login/data are not real credentials or database operations. Wiring these screens is Vertical Slice 01.

## Local setup

Node 24 (minimum 22), pnpm 11.19.0:

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:migrate
node --import tsx scripts/provision-runtime.ts
pnpm storage:setup
pnpm dev
```

Configure `.env.local` before applying migrations. Use staging Supabase for integration development or `supabase start` with Docker for a local stack. The supplied `supabase/config.toml` exposes `public` and `graphql_public`, never `app`. Private business tables are inaccessible through PostgREST and browser SDK. No Supabase Auth dependency is required.

For HTTPS production-like tests, use Vercel Preview. Session cookies always use Secure; never weaken the deployed cookie settings to accommodate a local HTTP tool.

## Environment

`.env.example` lists every setting without secrets. There are no `NEXT_PUBLIC_*` server secrets.

| Setting | Purpose |
|---|---|
| APP_ENV / APP_URL | local, staging or production; canonical origin and OIDC callback |
| DATABASE_ADMIN_URL | migration owner only, not supplied to Next.js runtime |
| DATABASE_URL | dedicated LOGIN member of fe_server, transaction pooler, no BYPASSRLS |
| DATABASE_WORKER_URL | dedicated LOGIN member of fe_worker; EXECUTE only |
| DATABASE_SSL | true for Supabase; false only for isolated local DB |
| SUPABASE_PROJECT_REF | provisioning helper for shared pooler usernames |
| SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY | server-only Storage API |
| SUPABASE_MEDIA_BUCKET | private `event-media` bucket |
| SESSION_SECRET | independent random secret for CSRF binding |
| AUTH_ENCRYPTION_KEY | random 32-byte base64 AES-GCM key for OIDC verifier/webhook payload |
| RATE_LIMIT_SECRET | random secret for hashing rate-limit subjects |
| TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME | environment-specific bot |
| TELEGRAM_CLIENT_ID / TELEGRAM_CLIENT_SECRET | Telegram OIDC credentials |
| TELEGRAM_WEBHOOK_SECRET | Telegram webhook verification |
| CRON_SECRET | Bearer authorization for internal worker/readiness endpoints |
| AUTH_RATE_LIMIT / GUEST_SESSION_RATE_LIMIT / PUBLIC_READ_RATE_LIMIT | limits per minute |

Create independent random secrets using `crypto.randomBytes(32)`; never put them in Git or ordinary chat. Migration and runtime database passwords are separate. Provisioner creates LOGIN roles only when absent; it does not silently rotate existing credentials. On a direct local database, provision the LOGIN users manually or adapt the shared-pooler provisioning helper.

Local `.env.local`, Vercel **Preview**, Vercel **Production** must be configured separately. Preview connects only to staging Supabase and staging Telegram bot. Production remains unconfigured until a separate production project and bot are ready. Never copy staging credentials into Production. Encryption key rotation requires a migration/re-encryption plan.

## Database

`pnpm db:migrate` uses the administrator connection, a transaction/advisory lock and `app_meta.migrations` checksums. Applied files must not be edited; add a new migration. Repeated runs skip matching files and reject changed checksums.

Migrations:

1. `202610100001_foundation.sql`: 18 contract tables plus encrypted Telegram inbox and distributed rate limits; UUIDs, bigint Telegram IDs, numeric prices, timezone/local datetime, RLS, grants, indexes and asset/subscription guards.
2. `202610100002_transactions.sql`: atomic reserve/cancel/soft-delete; private worker functions for leased delivery and consent rechecks.
3. `202610100003_webhook_worker.sql`: encrypted inbox leasing and channel updates, no implicit event opt-in.

Runtime fe_server is a trusted BFF group with explicit table policies and DML grants, no schema creation or superuser rights. It can read business rows, so each DAL/service operation must enforce resource authorization. Browser roles have neither schema/table grants nor policies. Worker has no table grants and can invoke only named SECURITY DEFINER functions with fixed search_path. Application schema must remain absent from hosted Data API exposed schemas.

`pnpm test:db` uses PGlite (actual PostgreSQL engine) to apply migrations on a fresh disposable DB and check grants, uniqueness, repeat reservation, own cancellation, optimistic version and soft deletion. It is not a test of the hosted pooler or remote network. Live verification requires configured staging credentials and `pnpm smoke`.

To reset a **disposable local** Supabase database, run `supabase db reset`. Do not reset hosted staging/production or drop their app schema to replay migrations. Synthetic DB fixtures are not automatically seeded in deployed environments. The internal readiness test creates/reads a synthetic user inside a transaction and rolls it back.

## Architecture and API

`Client → Next.js/BFF → DAL/services → PostgreSQL/Storage`.

- `src/app/api`: thin HTTP adapters.
- `src/server/auth`: secure session credentials, CSRF, rate limits.
- `src/server/db`: parameterized queries, authorization, transactions/idempotency.
- `src/server/services`: business operation boundary and DST-safe time handling.
- `src/server/telegram`: verified initData/OIDC/Bot API and inbox processor.
- `src/server/storage`: private bucket, signed upload, content inspection and cleanup.
- `src/server/notifications`: transactional outbox and leased worker.
- `src/lib/validation`: safe shared validation without credentials.

Success `{data,requestId}`; failure `{error:{code,message,fieldErrors?},requestId}`. Errors/logs never return SQL, cookies, bot payloads or stack traces. Request IDs are generated server-side. Boundaries are marked `server-only`; browser chunks are scanned in CI.

Implemented foundation endpoints:

- `POST /api/auth/telegram/mini-app` — raw initData, signed and no older than 5 minutes.
- `GET /api/auth/telegram/start` and `/callback` — OIDC, one-use state, PKCE, nonce, JWKS, signed profile ID mapping.
- `POST /api/auth/logout` — revoke current Organizer session.
- `GET /api/auth/csrf?context=guest` — session-bound mutation token.
- `POST /api/guest/session` — first anonymous write credential, optionally canonical linked user.
- `GET /api/v1/me` — authenticated sanitized Organizer DTO.
- `POST /api/v1/media/uploads`, `POST /api/v1/media/{id}/complete` — owner-scoped private image upload.
- `GET /api/v1/public/events/{publicId}/cover` — active event cover proxy for crawlers; no login, no private profile.
- `POST /api/telegram/webhook` — authenticated, encrypted durable inbox with update deduplication.
- `POST /api/internal/notifications`, `POST /api/internal/telegram-updates` — Bearer-protected processors.
- `GET /api/health` — public liveness only.
- `GET /api/internal/readiness` — Bearer-protected actual DB, schema, private Storage and DAL checks.

Organizer cookie `__Host-fe_org`: 256-bit random token, SHA-256 hash in DB, HttpOnly/Secure/SameSite=Lax/Path=/, absolute 30 days. Guest cookie `__Host-fe_guest`: same boundary, 180 days. UUIDs are not credentials. Mutations check exact canonical Origin and session-bound CSRF; bootstrap login/guest-session check Origin and rate limit. OIDC callback uses browser-bound state. Authenticated DTOs and media availability are no-store.

## Storage

`pnpm storage:setup` creates/updates a private bucket with 10 MiB JPG/PNG/WebP limits. Uploads have unpredictable paths and no overwrite. Pending assets cannot be attached. Completion verifies real content, rejects SVG/HTML/animation, limits to 20 megapixels, rotates and re-encodes to WebP without EXIF. Ownership/readiness is checked both in service and asset-locking DB triggers. External image scraping is absent.

`cleanupMedia()` deletes unattached assets older than 24 hours with attachment recheck/lock. This helper must be scheduled when media feature is enabled; failed Storage deletes remain retryable. If a crash leaves an untracked `ready/` object, a bucket inventory reconciliation job is still needed before Alpha. Event cover proxy stops serving deleted events; already cached third-party previews cannot be erased remotely.

## Telegram and notification scheduling

Use separate staging bot; the existing live prototype bot must not be repointed without a staging bot decision. Configure the same HTTPS staging URL in BotFather Mini App; register its origin and exact `/api/auth/telegram/callback` for OIDC. Copy Client ID/Secret to server environment. Login does not opt into notifications.

After environment setup, `node --import tsx scripts/telegram-setup.ts` registers the authenticated webhook and preserves pending updates. Inbox processor records a ready channel for a real private `/start`, or blocked state from membership updates. Linking/merging anonymous identities and `/start` handoff UX belong to a later slice; schema is prepared, the merge flow is not implemented.

Outbox contains only N1/N2/N3/N4. Worker rechecks consent, active event and N4 RSVP/schedule version; uses lease/SKIP LOCKED, max 5 tries, backoff/jitter, 429 retry_after and blocked-channel handling. Telegram delivery is at least once: a crash after acceptance but before DB acknowledgement can duplicate a message.

The worker endpoint is ready, but no automatic 60-second scheduler is enabled. Vercel Hobby cron limits are unsuitable for this cadence. Activate Supabase pg_cron+pg_net/Vault or another explicitly configured scheduler when the notification slice is implemented. Do not place worker secrets in source URLs. Full N1–N4 producing services and real Telegram delivery tests remain future slices.

## Time and transactional foundation

Event date/time/timezone remain separate; UTC effective/start/end instants are computed server-side. Temporal uses `disambiguation: reject` for DST fold/gap, including midnight. Date-only reminders use 09:00 local time one day before, not an invented event time. Cross-midnight events are rejected.

All future event child mutations must lock event before gift/RSVP/subscription. `app.reserve_gift` enforces this and one active reservation. `ownedEvent` returns 404 for a different owner; `expectedVersion` checks optimistic updates. `idempotent` stores payload hash/result in the same transaction, TTL 24h, different payload returns 409.

Surprise DTO projections and all product CRUD/RSVP endpoints remain slice work. Never expose raw reservation records to Organizer/Guest DTOs; Surprise ON must not contain any reserver identity or correlating reservation timestamps.

## CI, deployment, checks

`.github/workflows/ci.yml`: install, lint, typecheck, unit tests, fresh database tests, build and browser-secret scan. `vercel.json` selects Next.js and a frozen pnpm installation. Connect the existing Vercel project to this existing GitHub repository; branch `infrastructure-foundation` deploys as Preview. Keep main production prototype until reviewed merge. No manual file upload deployment.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
node --import tsx scripts/security-bundle.ts
SMOKE_URL=https://YOUR-STAGING-URL pnpm smoke
```

Read [infrastructure-status.md](docs/infrastructure-status.md) for observed resources and unresolved external setup. Alpha also requires live concurrency tests against PostgreSQL/pooler, full Surprise privacy tests, real Telegram cross-platform login/delivery, orphan reconciliation, retention/purge jobs, backup/restore rehearsal and the remaining product slices. Foundation tests do not claim those scenarios complete.
