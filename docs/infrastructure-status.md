# Infrastructure execution status

Source of truth: Technical Specification v1.0, 10 October 2026.

- Existing GitHub: andrianshneider/family-events-miniapp. Work branch: infrastructure-foundation.
- Existing Vercel: AST / family-events-miniapp. Production prototype preserved; Next.js work targets Preview/staging.
- Supabase staging: jjrjdogsjbdvacusvnki, Frankfurt, PostgreSQL 17.
- Production database/bot not provisioned; production secrets must never reuse staging values.
- User-owned UI mockups are preserved at repository root and copied unchanged to public/ for reference. Those screens still perform demo actions. No product vertical slice is claimed complete.
- GitHub branch and draft PR published: https://github.com/andrianshneider/family-events-miniapp/pull/1. GitHub CI on 9fb4dd8 passed all checks.
- All four hosted migrations applied successfully; private Storage event-media verified. Official Supabase CA is bundled and TLS certificate/hostname validation remains enabled.
- Vercel GitHub connection works: 9fb4dd8 Preview deployment is ready; public HTTP checks and full remote readiness smoke passed after user enabled staging access.
- Live DAL role/session/ownership/idempotency smoke passed with rollback; actual parallel reservation smoke passed and its fixture was removed. Public Data API rejects app with 406 PGRST106.
- Server and worker LOGIN roles have been provisioned with user authorization and separate random passwords.
- Remaining external setup: Telegram staging bot/OIDC credentials and Allowed URLs; then import those four variables into Vercel Preview and verify auth endpoints/webhook. Supabase, restricted DB connections, Storage and GitHub → Vercel are verified.
- Notification dispatch endpoint is implemented but scheduling is not enabled. Hobby Vercel cron is not suitable for a 60-second cadence; select an authorized scheduler or Supabase pg_cron+pg_net, storing its secret in Vault, when notifications are activated.

## Working organizer screens

The root now redirects to session-protected `/events`; unauthenticated visitors reach `/login`. The old `/01-telegram-login.html` and `/02-my-events.html` URLs redirect to working screens. Browser login uses OIDC; Telegram Mini App login posts signed initData to the existing verifier. The screen checks `/api/v1/me`, loads an owner-filtered, non-deleted projection from `/api/v1/events` (latest 100, with truncation notice), and logs out using CSRF protection. Loading/error/retry and real empty states replace demo controls. Event creation and detail editing are separate slices and are not exposed as fake working controls.

## Vertical Slice 01 — 10 October 2026

Implementation is published in `infrastructure-foundation` (`7cbbe52`) and staging Preview; CI and deployment passed. Migration 005 adds hash-only Mini App replay protection. Organizer events now support cursor pagination, and resuming the app rechecks the session. OIDC cancellation/failure returns to the Russian login screen. Both remote staging smoke scripts passed; temporary fixtures were removed. No main merge or production publication occurred.

Full acceptance remains pending real Telegram/Safari and installed iPhone PWA sign-in and callback return. See [verification report](01-organizer-auth-verification.md).

## Vertical Slice 02 — 10 October 2026

Event creation and the private organizer event page are implemented in `infrastructure-foundation` and staging Preview (`1feb189`). Existing schema is reused; no migration was needed. Published staging creation/Storage/concurrency/ownership smoke and Slice 01 auth/infrastructure regressions passed; synthetic records and Storage files were removed. Public invitation, editing, RSVP, gifts and notifications remain later slices. Address is manual because Mapbox is not configured.

See [Slice 02 verification](02-create-event-verification.md). Actual iPhone/PWA interactions and visual acceptance remain pending; source 01 Safari/Telegram return limitation is preserved.

## Vertical Slice 03 — 11 October 2026

Existing real event view/edit/audit were verified and extended with owner/session/CSRF/version/idempotency-protected DELETE, accessible confirmation, atomic soft delete, cross-tab invalidation and deleted-route/media protection. Migration 007 updates soft-delete service timestamps and serializes subscription consent with the event lock; 21 tables and existing restricted roles/resources remain. Implementation `d717b7f` is published on staging Preview, both GitHub CI runs and hosted auth/create-edit-delete/infrastructure checks passed; fixture cleanup completed. RSVP, Wishlist, Gifts and history are retained internally. N3 delivery, N4 rescheduling and physical retention purge remain subsequent work. Main/Production unchanged.

See [Slice 03 verification and iPhone scenario](03-event-management-verification.md). Browser interaction was unavailable because its administrative policy could not be verified; physical iPhone/PWA acceptance remains manual.

## Vertical Slice 04 — 12 October 2026

Public `/e/{publicId}` and sanitized PublicEvent API are server rendered and readable without login or guest session creation. Owner-only Share uses the existing immutable public_id/server origin, actual Clipboard/Web Share and documented Telegram URL fallback. Dynamic OG 1200×630 PNG with real private cover or brand fallback is accessible without cookies; public cover is bounded WebP. Noindex/nofollow and no-referrer retained; robots allows public metadata/images to be read. Soft deletion closes public pages/API/cover/OG and owner Share. No migrations/resources; 21 tables and existing roles unchanged. Implementation `ffab80b` is published in staging Preview, both GitHub CI and hosted public/create-edit-delete/auth/infrastructure checks passed; synthetic fixtures removed. Main/Production unchanged.

See [Slice 04 report and iPhone scenario](04-public-event-share-verification.md). Actual messenger preview, Telegram recipient selection and iPhone/PWA platform UI remain manual because browser policy verification was unavailable. RSVP, wishlist/reservation, opt-in and full analytics remain later slices.

## Vertical Slice 05 — 12 October 2026

Guest RSVP yes/no/maybe, own private context, safe reusable Guest Session/canonical binding, version/idempotency/CSRF protected writes and owner-only Guest List/summary are implemented. Event Management shows real latest responses; visible online organizer screens poll every 5 seconds across independent clients. RSVP and opted-in Organizer N1/N2 outbox persist atomically; delivery and full hand-off/merge/N4 remain later slices. Existing 21-table schema, roles and resources reused; no migrations. `ced4b87` Preview READY with stable staging alias; both CI runs passed. Hosted RSVP/auth plus create-edit-delete/public/Storage/infrastructure regression passed with synthetic fixture cleanup. Main/Production unchanged.

See [Slice 05 verification and iPhone steps](05-rsvp-guest-list-verification.md). Real physical iPhone/PWA/Telegram UI and browser polling acceptance remain manual; available HTTP/DB verification does not claim those interactions.

## Vertical Slice 06 — 12 October 2026

Real owner Wishlist/Gift CRUD, strict decimal/Unicode validation, private Storage image attachment/replacement/removal, safe public wishlist/details/preview and persisted Surprise are implemented. Gift soft delete atomically cancels an active reservation after explicit confirmation; server projections enforce identity privacy. Existing Event.version serializes Surprise setting conflicts; opaque revisions track reservation history and authorized display-name updates without public identity leakage. Interface copy is separated into a Russian catalog. Existing 21 tables/roles/resources reused, no migration. Final `6f17c45` Preview READY with stable staging alias; both CI passed. Local 40 tests/types/lint/build/DB/grants/secret-bundle and hosted wishlist including actual mutation/deletion races plus all Slice01–05 regressions passed with fixture/Storage cleanup. Main/Production unchanged.

See [Slice 06 verification and iPhone scenario](06-wishlist-verification.md). Public reserve/cancel, full hand-off/merge, notification delivery/scheduling and visitor analytics remain later slices. Actual iPhone/PWA/Telegram and browser visual interaction remain manual because administrative browser policy verification was unavailable.

## Vertical Slice 07 — 13 October 2026

Guest reservation service/API and private own-context endpoint reuse existing Guest Session, DB atomic functions/active unique index and idempotency. Guest list/detail share real reserve/cancel/name/confirmation/error/offline/lost-session actions. Exact reservation target protects against stale cancellation of a new choice; identity is always server-derived. Surprise public/private projections preserved. Migration 008 removes unnecessary PUBLIC execution grants for reserve/cancel while retaining fe_server. Existing staging migration applied; business commit `9d3427e` is READY on staging and both CI runs passed. 42 local tests plus hosted reservation/independent-connection races and RSVP/wishlist/Event/auth regressions passed; synthetic data cleaned. Browser anonymous choice/refresh/detail/cancel and another guest occupied/free state passed. Physical iPhone/PWA/Telegram remain user checks. See [Slice 07 report](07-gift-reservation-verification.md). No Production/main changes.

## Vertical Slice 08 — published, 13 October 2026

Organizer notification settings, verified permission/handoff, N1/N2 templates with private CTA, worker opt-out/block/lease safeguards and scoped one-use scheduler authentication implemented. Migration 009 adds one private Organizer handoff table (22 app tables), avoiding invented Guest identities. Existing Supabase pg_cron/pg_net staging job is active every minute and its automatic HTTP 200 run is verified; Vault secret remains private. The pg_net queue platform limitation is addressed with short-lived endpoint-bound nonce/HMAC proof instead of exposing a permanent secret. Corrected business commit `c28d4a8` Preview is READY; both CI runs, 46 local tests, hosted notification checks and Slice01–07 regressions passed. The user explicitly approved two real messages for a separate test event; delivery results and remaining physical-device acceptance are recorded in the [Slice 08 report](08-organizer-notifications-verification.md). Production/main unchanged.

Slice 08 real-recipient acceptance: the authorized N1 and N2 were sent automatically, acknowledged by Telegram, and the Organizer confirmed receiving both and opening the correct Event Management / Guest List through the message buttons. Retry and unchanged RSVP did not create a third job. A separate test event and one synthetic guest are intentionally retained. New native permission and broader installed-PWA behavior remain separate physical-device scenarios.

## Vertical Slice 09 — staging implementation, 14 October 2026

Guest event-scoped opt-in, source-bound hashed handoff/trusted Telegram confirmation, canonical identity merge with versioned explicit RSVP conflict resolution, own settings/opt-out, owner-confirmed N3 and future N4 planning are implemented. Existing scheduler/worker now support all four agreed notification types. Migration010 extends existing tables with handoff source/state and independent schedule_version; 22 tables/RLS/roles remain. `fdec193` Preview READY, both CI passed; 48 local tests, type/lint/build/clean migrations/secret bundle, hosted Guest notification flow and RSVP/reservation regressions passed with synthetic cleanup. Scheduler remains active. Real Guest N3/N4 and physical iPhone/PWA acceptance await explicit recipient opt-in and confirmation. See [Slice09 report](09-guest-notifications-verification.md). Main/Production unchanged.
