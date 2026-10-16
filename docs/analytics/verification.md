# PostHog P0 — verification, 16 October 2026

## Audit

Remote refs fetched and compared: infrastructure-foundation remains audited4be0caf before this work, main remains the early prototype. Existing root HTML/CSS edits preserved, sources untouched. Current Drive requirements/PRD/technical specification reread; the local Tracking Plan and Implementation Map are the contract. Prior Slice01–10 reports are history, not current device evidence. Existing app.analytics_events is a partial first-party journal with old CHECK names, not an already installed PostHog collector/exporter. These components are new in this change.

## Implementation Map

| P0 | Actual hook / enforcement |
|---|---|
| app_entered | AnalyticsProvider after opt-in, foreground analytics session, canonical context |
| user_authenticated | services/auth.authenticate → loginFact, actual new verified session only; replay/reuse branch untouched |
| event_creation_started | CreateEventScreen.change, first user field change, create only |
| event_created | original createEvent idempotent transaction branch → savepoint journal, snapshot origin |
| event_viewed | PublicEventScreen/EventScreen successful visible navigation → context+collector; no server-read producer |
| share_initiated/share_result | existing share/native/Telegram handlers after guards, real ready/cancel/unsupported/failure outcomes |
| invitation_link_copied | fulfilled clipboard promise only |
| rsvp_started | actual RsvpCard open state, create/edit mode |
| rsvp_submitted | saveRsvp !old branch; change/no-op never submitted |
| wishlist_viewed | WishlistScreen visible preview/full/management, preview intersection timer and navigation/surface dedup |
| gift_reserved | mutateReservation !old branch with gift/reservation/actor context |
| operation_failed | relevant visible client errors, bounded codes; no server duplicate producer or arbitrary error text |

Shared schemas: lib/analytics/contract + envelope. Same-origin consent/context/collect routes, private HttpOnly analytics visitor bridge. Server identity linking/first touch/queue delivery described in README. Internal UUIDs are not auth credentials and never serve as authorization. Source/body actor/classification are server-derived.

SDK transport adaptation: browser SDK intentionally absent; explicit client adapter forwards only contract data to first-party collector, server-only pinned SDK performs export. This is not a claim that PostHog SDK init/default hooks were enabled in the browser. There is no replay/autocapture/browser enrichment to redact after the fact. Default anonymous A is server-issued random analytics UUID; client/server resolve the same A through a bounded HttpOnly context.

## Local evidence

54 tests /23 files passed at foundation checkpoint, plus clean24-table migration/RLS/role checks. Tests include actual Postgres semantics (PGlite), real business create/idempotent retry, same anonymous actor/Event, forged context override rejection, no Guest Session created by view, first-touch/confirmed link, U1/U2 isolation, logout suppression, actual savepoint rollback recovery, outer rollback, queue outage/retry/stable IDs, consent denial, SDK compressed wire packet privacy and all12 reference queries. Q16 fixture: 2 created, 1 qualifying RSVP Event, separate gift-only Event → Active1, Engaged P0 lower-bound2. No PostHog/mock ACK is called real vendor delivery.

Types/lint/build and browser secret-bundle scan passed at checkpoint. Subsequent changes are rechecked before publication. Full P1 Engaged/notification/retention panels remain explicitly partial.

## Staging and external acceptance

Migration012 applied to verified existing staging DB (24tables); default app local config still uses localhost, so hosted smoke uses explicit staging origin and project-reference guards. Preview journal flag is enabled only for infrastructure-foundation. Vercel metadata confirms no POSTHOG_* configuration. Region/key/project choice requested from the owner; external export remains off. No Production setting/migration/deployment/capture, new bot/resource or user subscription/message change.

Current staging readback:24tables, anon Guest verifier false, worker true, existing scheduler active, last automatic HTTP200. Implementation commit 5d872330c5943c2f1f8b9243b643bcdb6bf4d71c was published as Preview dpl_CyFbksPGC8BsLxFhKiK9bAETEytb (READY), with staging alias verified. Both GitHub CI runs 38909603469 and 38909596660 succeeded. Final small follow-up and its checks are recorded below. Physical browser/PWA/Telegram behavior is not inferred from HTTP fixtures. Actual PostHog anonymous→identified merging, sent/readback count reconciliation and dashboard creation are blocked by missing project settings/access; no invented ingestion results.

## QA matrix

| Test | Evidence / limit |
|---|---|
| Q1 | Local committed create, dedup, verified-login hook/reuse audit; hosted synthetic HMAC login/replay passed (not real Telegram UI); real Telegram UI not claimed |
| Q2 | Existing actual nativeShare/clipboard helper tests (cancel/unsupported/failure) + hooks audit; actual system sheet remains physical |
| Q3 | Local collector/anonymous identity/Event join + no Guest bootstrap; hosted SSR/poll test passed; actual browser event+preview views recorded anonymously after consent |
| Q4 | Local journal/contract and existing atomic reservation tests; hosted first RSVP/reservation and replay/conflict API flow passed; P1 detail/start events deferred |
| Q5 | Local confirmed linking helper/first touch/create snapshot; actual new real-account cross-device PostHog reconciliation pending |
| Q6–Q7 | Local actual business retry/rollback/savepoint and exporter outage/lease/stable ID tests; no external provider verification |
| Q8 | Existing business no-op/version/deletion tests retained; P1 product events deferred |
| Q9–Q11 | Local verified identity/mixed-account/reset; existing business conflict tests retained; actual 3-surface acceptance pending |
| Q12–Q13 | P1 telemetry deferred; existing notifications/scheduling behavior preserved, no new messages authorized |
| Q14 | Allowlist and canary tests + actual SDK packet without browser defaults; hosted privacy canaries and strict-schema rejection passed |
| Q15 | First-touch/known-owner exclusion/unknown classification and mapping tested; traffic remains unknown unless internal registry assigns it |
| Q16 | All12 SQL definitions execute; deterministic Active1 / Engaged lower-bound2 fixture |

## Remaining access and scope

Need owner-selected existing non-production PostHog project and EU/US region, encrypted Preview key, then verified SDK ingestion and identity merge/readback. Need dashboard edit/read access for actual creation; complete first-party query definitions are delivered meanwhile. Production retains hard-off. Policy discrepancy: technical90-day retention vs proposed180-day plan; no unapproved longer retention configured. Automated retention/erasure workflow requires an explicitly reviewed maintenance setup before production; README describes the procedure and does not claim a live purge job.

P1/P2 list is in README; no scope expansion to new product CTA, invitations entity, fake sent/share/open counts or Session Replay.

## Hosted collector / business QA — passed

`scripts/analytics-smoke.ts` completed against the staging alias and existing staging database. Verified denied-by-default create, explicit allow, HMAC-auth session replay without duplicate authentication, create with idempotent retry, unchanged RSVP, reservation retry and second-guest conflict. Client/server facts shared anonymous actor and internal Event UUID; forged body Event/owner relation could not replace server context. First-touch persisted. SSR/public API polling did not create views or Guest Sessions. Invalid/PII properties and client-produced success names were rejected; URL/public-locator/text canaries were absent from journal payloads. Withdrawal suppressed outstanding jobs and prevented subsequent capture even with the old visitor cookie. All scoped synthetic fixtures were removed.

This used actual staging APIs/DB and synthetic authentication fixtures. PostHog export stayed unconfigured; no fake transport was used to mark staging jobs sent. Local outage/drain tests and an SDK packet test cover protocol behavior, not real vendor readback.

## Browser QA — partial

Actual foreground in-app browser opened a separate synthetic public Event. Explicit analytics allow became visible, and DB readback confirmed one event_viewed plus one wishlist_viewed preview, with anonymous visitor, no Organizer context and no bound Guest identity. The pre-existing invalid Guest cookie displayed the correct lost-session recovery. Continuing the recovery was blocked by a JavaScript confirmation dialog the browser tool could not control; user assistance was requested. No actual browser RSVP/reservation or native share is claimed. The independent hosted API flow above passed. Browser fixture and its synthetic owner/journal were removed with ID, owner, creation-time and anonymous-context guards; no real account was modified. Screenshot captured before cleanup: analytics-staging-consent.jpg (the test invitation is intentionally no longer live).

## Final follow-up

OIDC failure instrumentation uses a random consented per-attempt UUID in sessionStorage, never OIDC state/token; retry/refresh uses the same fact ID. Consent copy accurately excludes names/text/addresses/screen recordings while bounded RSVP status remains in the approved contract. Queue health alerts on terminal failures as well as stalled jobs. Typecheck, lint, focused analytics tests (3) and production build passed after these changes. The full 54-test suite/clean migrations passed at the implementation checkpoint; no additional business logic changed in this follow-up.
