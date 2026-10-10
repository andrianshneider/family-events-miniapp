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
