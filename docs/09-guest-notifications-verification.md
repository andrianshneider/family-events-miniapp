# 09 — Guest Telegram notifications

## Sources and audit

Read-only current Drive instructions, PRD §§13/31–35, Technical Specification v1.0 §§1.5/1.9/2.3/3.2–3.3, screen 20 spec, screen 06 change confirmation and screen 10 RSVP success. Existing Slice01–08 verified sessions/public Event/RSVP/reservation, private roles, outbox/worker and minute scheduler are reused. Source/root mockup edits are preserved.

Existing Guest bootstrap had deliberately refused anonymous/canonical merges. Guest opt-in/handoff completion, N3 decision and N4 planning were absent; worker allowed N1/N2 only. Existing reminderAt implements exact 24h or previous-day09:00. PRD forbids no reminder; specification explicitly permits maybe with neutral copy. These agreed rules are retained.

## Implementation

Guest CTA after RSVP and on returning Public Event opens `/e/{publicId}/notifications`. Explicit consent is per event. Web handoff hashes a 256-bit token, binds source GuestSession/Event and expires after10min. Trusted private bot `/start guest_<token>` verifies the account/channel; only the original GuestSession can explicitly accept this account and complete the binding. Native SDK write access uses server-validated signed permission; insufficient/stale proof offers the actual bot flow. No SDK callback/unsafe ID establishes identity.

Canonical merge locks user, identities in stable UUID order and affected events. Different-event RSVP and reservations move; conflicting same-event answers require explicit choice with both versions. Session credentials move to canonical identity; completion issues a fresh HttpOnly cookie. Existing subscriptions of canonical identity retain event scope. Unlinked identities cannot have a valid Guest subscription. Replay of completed proof does not re-enable an opted-out event. Anonymous Guest functionality remains available.

Migration010 extends existing auth_handoffs with source session/state; adds events.schedule_version independently of general edit version; app table count remains22. Worker verification function is restricted to fe_worker. Existing RLS/client isolation, HMAC scheduler proof and exact text→timestamptz lease handling remain.

Significant save records one change snapshot, reschedules when date/start/timezone changes and proposes send/skip when there are subscribers. Owner/session/CSRF/version/idempotency-protected decision atomically stores send/skip and creates one N3 per eligible subscription. Replays do not enqueue again; stale pending decisions are rejected. Before send, stale N3 snapshots are rejected against latest significant change. Public CTA carries only event link.

N4 is planned for yes/maybe with active event-scoped subscription/ready channel, never no/no RSVP. Exact24h with start; previous-day09:00 in Event timezone without start; overdue new planning is skipped. Date/start/timezone changes advance schedule_version; unrelated edits cannot resend delivered reminder. Pending payload updates use real current details. Decline/opt-out/block/delete cancel jobs; unsent cancelled future schedule may be rearmed, never sent jobs. Worker rechecks event/canonical identity/RSVP/consent/channel/schedule and uses existing retry/429/403 controls.

## Verification status

Local: 48 tests passed, including restricted PostgreSQL canonical merge/conflict, session/reservation preservation, handoff expiry/replay/source isolation, N3 dedup/cross-owner, stable schedule versions, sent reminder not rearmed, no suppression, controlled worker acknowledgement/dedup/CTA, DST/date-only/overdue timing. Existing Slice01–08 tests passed. Type/lint/build/clean22-table migration and secret-bundle checks passed. Mock Bot API is not real delivery proof.

Staging publication/migration/HTTP smoke and real recipient verification are pending. Synthetic staging smoke requires paused scheduler and never sends Bot API messages; it cleans only its own fixtures. Production/main remain unchanged.

## Manual scenario

1. In a private browser open a disposable event, RSVP yes, reserve a gift. Without opt-in no Guest messages.
2. After RSVP choose “Получать напоминания в Telegram”, open bot, tap Start, manually return if necessary. Check server verified account, explicitly accept. Refresh: enabled, same RSVP/reservation.
3. Use same confirmed account from another Telegram/device context: same canonical answer/gifts. If another browser already answered same event, linking asks which version to keep; no silent merge.
4. Cancel/deny connection and test expired link: anonymous answer/gifts survive, fresh connection is possible. Do not send cookies/tokens in feedback.
5. Organizer changes several significant fields in one save. Choose send: one N3, public Event CTA. Same decision retry creates no second job. Skip/non-significant/no-op save creates no message.
6. Before a test reminder window, opt in with yes. Check one actual N4 and CTA. Change to no before deadline: no N4. Maybe gets neutral text. Date-only follows previous-day09:00 rule.
7. Move date/time before old deadline: old reminder cancelled, only new schedule eligible, regardless of N3 send/skip. Opt-out/soft delete stops queued delivery.
8. Repeat in iPhone Safari, installed PWA and Mini App; assess safe-area, permission popup, manual return, offline/retry and refresh. Real message count/recipient/event must be explicitly authorized first.

## Limits

One outbox job per business trigger and ordinary replay/worker dedup are enforced. Telegram Bot API cannot guarantee absolute exactly-once after an accepted send whose response is lost; retries may duplicate that ambiguous external send. Safari/PWA automatic return from Telegram is not platform-guaranteed; manual return restores server state. Gift reservation notifications are outside this slice.

## Staging results — 14 October 2026

Migration010 applied on existing staging. Business commit `fdec193`, deployment `dpl_FTnZyizbvxHo9Jz7MvLVenkRZQbn` READY. CI runs 38530030152 and 38530036951 succeeded. Hosted Guest notification smoke passed actual API source/CSRF/forged proof checks, trusted worker handoff expiry/replay flow, explicit merge conflict, N3 summary/replay, exact future schedule, reschedule cancellation, lease verification and opt-out. No Bot API was called for synthetic identities; scoped cleanup completed and minute scheduler restored active. Hosted RSVP and reservation regressions passed with cleanup.

Browser automation could not initialize (desktop app-server unavailable); no physical UI acceptance is claimed. A separate public test event is prepared under a marked synthetic Organizer for real Guest delivery. The recipient must opt in from their own browser and confirm the actual Telegram account. A question requests explicit authorization for two messages (N3 + N4); neither has been sent yet. Private fixture credentials remain ignored, and public invitation is provided to the user for their device check.

Staging infrastructure readback: app tables22; anon Guest handoff EXECUTE=false; worker EXECUTE=true; minute scheduler active=true; latest automatic HTTP response200, timed_out=false. Final UI hardening reports blocked channel distinctly, bounds native permission waiting and avoids overlapping status polls. Browser acceptance remains user-assisted.

Final business Preview `b55c76f`, deployment `dpl_9btbyXSoAFfhxJqkMiAACnLSP78Z`, is READY. Both CI runs 38531594506 and 38531602895 succeeded; final local build/types/lint and browser secret-bundle checks passed. Real test invitation: https://family-events-staging.vercel.app/e/_3J5Cc1rYqrzgXigilhjtw. A marked synthetic Organizer owns this disposable event; it has no Organizer subscription. Guest opt-in must be performed by the real recipient. Real N3/N4 authorization remains pending; no message dispatch was triggered by the agent. On authorization and confirmed Guest opt-in, the normal edit/decision API will move the event start to 24h plus about7min ahead and queue one summed N3, with one N4 on the new schedule. The old schedule is cancelled through normal product logic. The fixture is retained for this user-assisted test; automated fixtures are cleaned.

## Guest handoff recovery fix

User screenshot showed pending connection alongside an enabled “Подключить Telegram” button. Server history confirmed that repeated initiation cancelled a previously verified attempt and created a new pending one. Initial link also lived only in component memory, so refreshing lost its URL.

Migration011 retains only AES-GCM ciphertext of the short-lived link token alongside its SHA-256 verification hash. The original authenticated Guest Session may recover its pending link until expiry; no public/foreign session receives it. Begin reuses pending attempts and preserves verified attempts instead of cancelling them. Pending UI offers the existing link and check/cancel; legacy attempts can recover a fresh link explicitly. No cancelled or expired Telegram verification is resurrected. Regression checks cover repeated begin, source recovery and preservation of verified state. Real-recipient approval for N3/N4 has now been explicitly received, but delivery still waits for source-browser account confirmation.

Recovery fix staging result: `f47aeaa`, deployment `dpl_31JsXggRV2rcLoHixFmYrXxQB5TP` READY; migration011 applied. All48 local tests/build/types/lint passed. Hosted smoke now additionally verifies same pending id/link on repeated begin, recovery from authenticated settings after refresh, and preservation of a verified attempt on repeated begin. It passed; synthetic fixtures cleaned and scheduler active restored. The user's cancelled/expired prior verification is not restored without a fresh trusted Telegram confirmation.

## Confirmation feedback / account context fix

Another screenshot reached verified-account confirmation but appeared unchanged after clicking. Background polling cleared mutation errors every5s. Polling now clears only its own connection error; mutation feedback persists until explicit retry. Settings expose only a boolean account-conflict flag when the verified Guest account differs from the active Organizer session. The UI explains this before completion and offers an explicit “Выйти из Organizer и продолжить гостем” using the existing CSRF-protected logout. It never silently signs out or rebinds an account; RSVP/reservations and the source Guest session remain. Cross-account guard remains enforced. Regression verifies the guard and flag, with completion permitted in Guest-only context. The real recipient is the account explicitly accepted through source-browser completion; prior Organizer account is not a requirement for Guest notification delivery.
