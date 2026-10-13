# 08 — Telegram notifications for Organizer

## Scope / current status

Implementation targets existing `infrastructure-foundation`, Vercel Preview/staging `family-events-staging.vercel.app`, existing Supabase staging and `FamilyEventsMiniAppBot`. Production/main unchanged. Real account permission and real message/CTA confirmation are a separate required user-assisted final check; automated fixtures do not claim real Telegram delivery.

Sources: development instructions, PRD §§31–35/61, Technical Specification v1.0, design screen 20 / Organizer part and Event Management / Guest List. Source documents and synced files are read-only. Prior slices 01–07 retained.

## Audit / changes

Existing signed Mini App / OIDC sessions, private role/schema, webhook encrypted update queue, `telegram_channels`, event-scoped `notification_subscriptions`, atomic RSVP/outbox dedup, worker leases/retries are reused. Missing Organizer settings/consent, write-access service updates, bot token handoff, CTA payloads, old/new RSVP text and persistent scheduling are implemented.

Routes:
- `/events/{eventId}/notifications`, linked from Event Management.
- GET / PUT `/api/v1/events/{eventId}/notification-subscription`.
- POST `/api/v1/events/{eventId}/notification-handoff` `{mode:'mini_app'|'bot_start'}`.
- POST `/api/v1/events/{eventId}/notification-permission` `{initData}`.
- Internal POST `/api/internal/organizer-notifications` runs verified updates then N1/N2 delivery.

All owner routes derive user/event ownership from the live server session, protect mutations with Origin/CSRF and existing limiter; private no-store responses omit chat ID, Telegram ID and raw handoff secret from settings readback. Toggle receipts are scoped/idempotent; UI always rereads current settings after mutation/replay. Failed save preserves server state, unknown result retains same operation key, offline/pending controls disabled.

Permission ≠ authentication ≠ event opt-in. Native requestWriteAccess is user-triggered; its client callback does not grant server permission. Proof is a trusted webhook `write_access_allowed` or a fresh server-validated signed `allows_write_to_pm` claim matching current Organizer. Stale signed permission cannot override a newer known block.

Browser/PWA uses a 256-bit, hash-only, 10-minute token, bound to Organizer user, source session and event. Trusted bot `/start notify_<token>` must match same verified Telegram ID/private chat and live original session. Wrong account, replay, expiration, cancellation and deletion reject consent. Basic `/start` establishes channel only, not event subscription. Explicit handoff/connection grants consent only for selected event. A new intent cancels older pending intents. Opt-out cancels pending/processing jobs and pending intent so late proof cannot silently turn it back on.

Migration 009 adds `organizer_notification_handoffs` (guest handoff table cannot represent an Organizer without inventing a guest identity), bringing app tables to 22. RLS/private grants, worker-only SECURITY DEFINER confirmation, per-user advisory serialization, live session and event checks. It tightens existing worker execution grants, lease guards, blocked handling and opt-in checks; N3/N4 remain inactive. New dated channel update ignores late proof preceding a newer verified state. 403 and bot block revoke subscriptions/cancel pending jobs; stale worker lease cannot block a restored channel.

N1/N2 transactionally use existing unique `(subscription_id,type,trigger_key)` with RSVP id/version. No-op and replay do not enqueue again. Plain-text Russian templates describe yes/no/maybe truthfully, N2 uses saved previous values and actual changed fields. Safe inline URL buttons target private event / guests routes; login allowlist now preserves these event/notification destinations. No credential/personally identifying payload is placed in CTA URL. Existing old text-only outbox payloads remain readable.

## Scheduler and delivery guarantee

Existing Supabase supports pg_cron/pg_net; a single staging job runs each minute, calling only the Organizer pipeline. No laptop loop or Codex heartbeat. Setup script `scripts/organizer-notifications-scheduler.ts` has prepare/enable/pause/status; it guards exact existing staging and prepares disabled.

**Verified platform constraint:** hosted Supabase pg_net transit request queue is readable to database roles, and project-level REVOKE/RLS changes are not supported. See [official explanation](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357). Therefore the job never puts long-lived CRON_SECRET in URL/headers/body. Vault holds the existing secret, inaccessible to anon/authenticated. Each HTTP request carries an endpoint-scoped 120-second HMAC proof, nonce and timestamp; server validates MAC/lifetime and atomically consumes nonce through existing `api_idempotency`. Repeated proof returns receipt without processing another batch. Invalid/arbitrary bodies rejected. A database-role observer could race redeeming that one already-authorized proof, but cannot sign future proofs or invoke any other privileged endpoint; response contains only aggregate processing counts. Database and Node signature formats verified equal without revealing values.

Manual internal Bearer secret endpoints remain available only to trusted operators. Scheduler has no N3/N4 scheduling/delivery activation. Worker claims using SKIP LOCKED, retries up to five with backoff/jitter and respects Telegram retry_after; permission/opt-in/Event rechecked before send. Network/ambiguous Telegram outcome retries may duplicate a message already accepted by Telegram before its acknowledgement was lost. Exactly one outbox record is guaranteed; absolute exactly-once Bot API delivery is not. Such outcomes remain observable via safe error code/attempt/provider-message metadata, never raw RSVP/secret logs.

## Checks

Local automated tests currently pass 46 tests / 20 files. New tests exercise actual API/services through restricted PGlite migrations: owner/CSRF/input, consent/handoff account mismatch/replay/revoked session, N1/N2/no-op/dedup, CTA, worker success/lease/opt-out/429/403 and stale lease. Scheduler tests check tampered/expired/future proof, single nonce execution and arbitrary body rejection. Existing auth/Event/RSVP/wishlist/reservation tests retained. Worker Bot API tests use controlled mock responses and do not count as real Telegram delivery.

`organizer-notifications-smoke.ts` uses existing staging HTTP APIs/DB roles and synthetic identities with scheduler paused and an empty queue. It validates signed proof, forgery, account binding, real webhook processing, job dedup/CTA/opt-out and independent worker claims. Synthetic jobs are cancelled, never falsely marked sent or delivered to fabricated Telegram identities. Scope guards/time markers and cleanup preserve real user data. Final staging/CI/scheduler/browser findings are appended after execution.

## User-assisted final test / expected results

1. Open a separate staging test event as Organizer → «Настроить уведомления». Expected: real event/account, current server connection state, no enabled subscription without permission.
2. Mini App: tap «Разрешить сообщения и включить уведомления», accept Telegram native popup. Web/PWA: prepare connection → «Открыть Telegram» → «Запустить» with the same account → return to original settings. Expected: backend confirmation; «Новые ответы гостей» ON for this event only. Allow up to one minute for scheduled update processing. Safari return may be manual; returning/polling must restore result.
3. Refresh settings. Expected: persisted channel/subscription state. Declining permission keeps event usable and messages disabled.
4. After explicitly authorizing this account as test recipient, submit a synthetic new RSVP via public link. Expected: one N1 message from existing bot, truthful status/counts and «Открыть событие».
5. Tap CTA. Expected: this Event Management; if login needed, confirmed login returns here. Other accounts cannot access it.
6. Change that same synthetic RSVP from yes to no. Expected: one N2 with «Было: Буду / Теперь: Не буду», and «Открыть гостей» opens this event's Guest List.
7. Refresh/repeat same submitted operation without actual change. Expected: no additional notification. Repeated ordinary job processing likewise has no duplicate.
8. Switch OFF, submit another synthetic change. Expected: no message, setting persists. Turning ON does not replay cancelled history.
9. Optionally use a disposable test account to test blocking bot/refusal/re-enable; avoid changing a real account's channel unexpectedly. Expected: blocked channel disabled, no infinite retries, explicit reconnection.
10. Repeat settings/CTA on iPhone Safari, Telegram and installed PWA: safe-area, native permission, offline/error/retry, same user and secure return path.

Do not send cookies/initData/tokens or personal guest answers. Real messages/CTA and physical-device checks remain pending until user confirmation; do not mark the slice fully accepted beforehand.
