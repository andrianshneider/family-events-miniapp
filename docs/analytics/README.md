# PostHog P0 — Family Events OS

Implementation target: existing `infrastructure-foundation`, staging only. Production capture is hard-disabled in `enabled()`. The original Tracking Plan remains the specification; this file describes implementation, not a claim of live PostHog acceptance.

## Transport and privacy decision

Use pinned `posthog-node@5.54.1` on the server only. The browser has a typed explicit adapter and same-origin context/collector, **no PostHog browser SDK**. This deliberate transport adaptation avoids browser URL/referrer/title/device/session defaults and does not expose a project key. Server-issued anonymous UUID A is the analytics identity; it is unrelated to auth cookies. The actual SDK wire-format test checks compressed outgoing data. No autocapture/pageview/pageleave/replay/exception capture or feature-flag requests are initialized. GeoIP enrichment is disabled and outbound properties force the constant `$ip=0.0.0.0`. Live ingestion initially added the SDK server egress IP without this mask; the two follow-up captures verified that the explicit mask prevents it. No guest IP is read or forwarded. The project-level Discard client IP data setting is also enabled and confirmed in PostHog. Raw public locators travel only to the first-party context/collector; exported `event_id` is an internal UUID.

All 13 P0 events have allowlisted schemas. Client context derives actors from verified sessions; submitted actor IDs/classification cannot override them. Public GET/SSR/OG/polling do not create facts or Guest Sessions. Preview requires >=50% visibility for >=1s; full views require a visible successfully loaded screen, deduplicated by navigation+surface. P0 sources and properties match the contract in `src/lib/analytics/contract.ts` and common envelope schema. Invalid default/unlisted properties never leave the exporter.

As explicitly requested by the owner on17 October2026, analytics is enabled by default for a new client context without a permission banner. A small collapsed settings control at the page bottom supports opt-out/opt-in. Existing denied choices, revoked visitor contexts and identified-user denials remain respected; default bootstrap never clears them. The database consent field represents whether capture is permitted, not a claim of explicit consent for new default contexts; their choice cookie is `default`. Telegram write permission is unrelated. Denial suppresses queued records across this browser's consent group and marks an identified user's global preference. Queued jobs are rechecked immediately before send. In-flight requests already sent cannot be recalled. Separate confirmed opt-in is needed to resume. Product actions continue without analytics. Source HttpOnly analytics cookie is not an auth credential and is never exported.

Canonical identified distinct_id is app.users.id. Guest UUID is first-party only and is never identified as a separate person. Confirmed login/allowed Guest binding queues `$identify` linking anonymous A to U; no `user_authenticated` is created for handoff verification or linking. These are control messages, not extra product taxonomy. Mixed U1/U2 context rotates anonymous identity before identifying U2. Confirmed logout creates a fresh anonymous context with guest re-identification suppressed; an expired known Organizer session is similarly reset. A stale Guest cookie cannot silently restore the former identified browser. No identity matching by names/IP/event IDs. The existing business conflict/explicit-confirmation rules remain unchanged.

## Transactional journal

Migration012 extends `analytics_events`; existing rows stay schema_version=NULL/delivery_status=legacy and never enter new cohorts. It adds two private RLS tables: analytics_visitors and explicit analytics_traffic registry (24 app tables total). Anonymous/unclassified traffic stays `unknown`; only an internal registry can assign external/staff/synthetic. Names are never classification signals.

The existing event_created/rsvp_submitted/gift_reserved producers are enriched/replaced in their original idempotent transactional branches; no second client-success producer. New event_created includes immutable origin snapshot and optional form/attempt correlation. RSVP edit/no-op and existing active reservation do not create these P0 success facts. Old incomplete P1 producers are no longer written; P1 is not silently launched. Optional analytics uses PostgreSQL savepoints; failures produce a bounded `analytics_journal_lost` operational log, not a broken business transaction. External calls happen only after commit.

Delivery is at-least-once with a lease, retry/backoff and stable SDK UUID + `$insert_id` equal to journal row ID. SDK captureImmediate must finish before durable `sent`. Lease guards prevent stale workers overwriting suppression. Schema rejection is terminal/observable; network failures retry without a new fact. The existing authenticated minute scheduler runs analytics after Telegram work when its time budget permits; it defers analytics after 40s. Analytics has its own journal/lease and never uses Telegram notification outbox. A dedicated protected internal endpoint and queue CLI support maintenance. No separate scheduler/resource was created.

First qualifying public touch stores Event UUID + server UTC timestamp. Subsequent invitations cannot overwrite it. Verified linking reconciles the earliest non-owner touch across source/target identities. Existing Organizer vs new first Organizer is distinguished in the metrics by actual earlier Event creation; the origin snapshot alone is not a viral-conversion claim. Unknown origin remains unknown. No legacy attribution backfill is invented.

## Configuration — server variables only

| Variable | Value / purpose |
|---|---|
| ANALYTICS_ENABLED | `true` only in the branch Preview for staging; absent/false disables collectors/journal/UI |
| POSTHOG_ENVIRONMENT | `non-production`; separate non-production project is mandatory |
| POSTHOG_HOST | Owner-selected `https://eu.i.posthog.com` or `https://us.i.posthog.com`; no region fallback |
| POSTHOG_PROJECT_KEY | Actual non-production project key, encrypted Vercel Preview variable; never NEXT_PUBLIC |
| APP_ENV | Existing `staging` |
| VERCEL_GIT_COMMIT_SHA / APP_VERSION | Deployment commit SHA / local test build identifier |

Live staging setup (17 October 2026): existing FamilyEvents organization / Default project670592, US Cloud. The branch Preview has encrypted POSTHOG_HOST, POSTHOG_ENVIRONMENT and POSTHOG_PROJECT_KEY; no key is in Git or browser code. Exporter configured=true and real ingestion/readback passed. Without these settings in another environment, exporter returns configured=false. Set variables in Vercel project family-events-miniapp, Preview, branch infrastructure-foundation; never Production. Redeploy that branch. Project/region and staging ingestion have been verified by PostHog readback; repeat that verification when changing projects. No personal API key is needed for capture; dashboard creation/readback needs separate authorized access.

Commands with existing Node runtime/pnpm:

```
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
pnpm build
node --import tsx scripts/security-bundle.ts
node --conditions=react-server --import tsx scripts/analytics-queue.ts
node --conditions=react-server --import tsx scripts/analytics-queue.ts --drain
node --import tsx scripts/analytics-smoke.ts
```

Queue health returns counts/status/oldest age only, never payloads/identities. Investigate pending/processing age >5min, schema failures or `analytics_journal_lost`; do not mark jobs sent manually. Restore configuration/network, drain with the same IDs, then compare PostHog counts against committed new-contract rows, separately accounting for consent, synthetic, control and legacy exclusions. HTTP ACK alone is not a readback of correct person merging.

## Dashboard v1

`dashboard-v1.json` contains 12 complete PostgreSQL reference query definitions and availability labels. Default production/external/schema1.0, Moscow calendar boundaries, 28 full days, mature windows. They resolve canonical actors first-party and join actor+Event for guest funnels and **Event only** for Organizer→Guest. No sensitive data-source connection to PostHog is created. Only aggregate query outputs may be shared outside the first-party environment. These reference queries are not mislabeled as directly executable HogQL.

To configure an authorized PostHog dashboard: create **Family Events — MVP Product Dashboard**, set Europe/Moscow, separate non-production project during QA, build supported event-native panels from the same definitions and use bounded aggregate outputs for relational panels where a native query cannot preserve the join. Do not substitute a person funnel for Organizer→Guest. Keep n/N, coverage and immature cohorts visible. Detail/reservation-start, full Engaged Events, notifications and long retention panels requiring P1/history remain labeled unavailable/partial. There is no delivered-invitations, open-rate or classical K-factor panel. The actual staging dashboard is now created and read back: https://us.posthog.com/project/670592/dashboard/2223265. `dashboard-posthog-v1.json` contains runnable HogQL adaptations; `live-posthog-readbacks.json` records saved insight IDs and aggregate QA results. The relational PostgreSQL definitions remain the exact first-party reference for historical ownership/first-organizer checks. PostHog observed Guest→Organizer is explicitly partial for history before P0.

## Retention and erasure

Technical specification says 90 days; Tracking Plan's 180 days is proposed, not approved. Retain the 90-day baseline; do not enable longer storage or new PostHog retention without the owner's decision. Reference repeat-creation/90–180d metrics are therefore limited until policy/history are sufficient. Production remains off. Configure actual vendor retention/access roles before external rollout. No replay retention applies while replay is off.

Erasure procedure: first revoke consent and suppress pending/processing for verified U and its proven anonymous visitor mappings; collect only their internal distinct IDs into a private deletion registry; delete the corresponding PostHog person/events via authorized project controls and verify deletion, then remove journal/control records and visitor mappings in FK order. Do not erase other accounts in a shared consent group merely because consent revocation affected that browser. User erasure requests must prove the account/current anonymous context; no name/IP matching. Storage, RSVP, gifts and auth identity are separate business retention and are not deleted as an analytics side effect. No deletion was requested/executed in this integration.

## P1 / P2

P1: 16 taxonomy events (including RSVP changes, wishlist lifecycle, reservation intent/cancel/detail, subscription/notification terminal results, explicit identity_linked), complete notification/retention widgets and richer reconciliation diagnostics. Linking necessary for P0 identity already works as a control operation; that does not enable the P1 product event. P2: two PWA diagnostics and separately approved privacy-tested replay. No new product CTA or business rules added for measurement.

## Remaining acceptance

Live PostHog project/region/key, ingestion, anonymous→identified merge, counts and 12 dashboard widgets are verified as of17 October2026. See `live-acceptance-2026-10-17.md`. Synthetic fixture evidence is retained in PostHog and excluded from product metrics. Device installation, actual iPhone/PWA OIDC/system Share and real Telegram handoffs remain physical/manual checks. No new Telegram messages or user subscription changes are authorized by this integration.

Reference SDK sources: https://posthog.com/docs/libraries/node, https://posthog.com/docs/getting-started/identify-users, https://posthog.com/docs/privacy/data-collection. Source API/types and a mocked compressed HTTP packet were checked for version5.54.1. No real project or dashboard was accessed by those tests.
