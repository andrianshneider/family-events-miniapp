# 07 — Gift Reservation: implementation and verification

## Scope and sources

Existing repository, `infrastructure-foundation`, existing Vercel Preview/staging and Supabase staging `jjrjdogsjbdvacusvnki`. No main merge, Production deployment, new bot, bucket or project.

Source contracts: [development instructions](https://docs.google.com/document/d/10kmsdz5r4npcpg5MK0Yq_RgGFObfUTPpaAFT92nBvfc/edit), [PRD §§27–29/60](https://docs.google.com/document/d/1fIecJjtJZKOtvpBx_uS6XVmKlwi6Fm-hUxmdbODAzRE/edit), [technical specification](https://docs.google.com/document/d/1HrYTqMQAW-82OZBLHN9VO3JrNzccGqR0QgHjMYiU39o/edit), [design folder](https://drive.google.com/drive/folders/1ebHh9Y6BTHK9Y3TtJZBILIaSLYUfFepd), screens 17/18 and existing related 13/16/Public Event/RSVP. [Slice06 user feedback](https://docs.google.com/document/d/13nW6NIgYd0IiKFB0WKC7NcCgGd6CgsCZRndXSv1O1wo/edit) remains implemented: separate labels/10px gaps, Мб, portrait photos and stable background refresh. Sources are read-only.

## Audit and contracts

Existing schema already provides `gift_reservations`, partial unique index `uq_gift_active_reservation` and SECURITY INVOKER functions `reserve_gift` / `cancel_reservation`. Existing Guest Session, RSVP, owner mutations, Surprise projections, idempotency and deletion cancellation are reused. Server Guest reservation APIs and guest actions were missing.

New endpoints:
- POST `/api/v1/public/events/{publicId}/gifts/{giftId}/reservation` `{guestName?}` plus Idempotency-Key.
- DELETE same route **requires `{reservationId}` plus Idempotency-Key**. This additive detail identifies the exact own reservation being cancelled: a delayed request for old reservation A cannot cancel new reservation B. No identity or ownership proof is accepted from the client.
- GET `/api/v1/public/events/{publicId}/my-reservations?cursor=...`: only the current guest's active reservations, own default name, session state and existing opaque contextKey. Pages of 100, stable UUID cursor, client retrieves all pages. No guest bootstrap during reading.

Writes resolve principal from existing HttpOnly cookie, require Origin/guest CSRF, use existing distributed session/IP rate limits and recheck live session inside transaction. Lock identity → shared live session row → Event → Gift, consistent with existing RSVP identity → Event. DB functions preserve Gift locking and unique constraint. ID/event relationship checked before work; soft-deleted entities unavailable. Cancellation validates exact own target under locks, preserves history and `guest_cancelled`; repeated cancellation has no side effects.

Name is trimmed and validated by Unicode code points (2–60). Current event RSVP name takes precedence, otherwise explicit name or existing guest default. Name/choice saves in the same transaction; RSVP is not created/modified. Repeated reservation by same identity returns existing record. Receipts are identity/route/key/payload scoped; timeout reuses original key. UI rereads own state before claiming current ownership, including stale receipt after external cancellation.

Migration `202610130008_reservation_permissions.sql` only revokes inherited PUBLIC/anon/authenticated EXECUTE for the two functions and explicitly retains fe_server EXECUTE. Existing invoker/table/schema isolation already protected records, but function grants created after foundation had unnecessary default PUBLIC access. Staging readback: anon_execute=false, server_execute=true. No new tables or data backfill.

## Privacy, UI and synchronization

Public list/detail DTO and SSR remain sanitized and contain no own ownership or guest identity. Private own context is fetched client-side with private/no-store replies. Guest list does not expose other names/reservation IDs. Owner Surprise ON stays status-only; OFF exposes only display name through existing SQL CASE. Existing HMAC revision includes all reservation history versions and remains opaque.

List/detail share the reservation controller/dialog: name form without registration, free/own/other actions, explicit cancellation confirmation, Russian transport/conflict errors, retry with frozen unknown payload, offline disabling, lost-session explanation and explicit new-session action. Session/context changes clear own state and dialog. Only the existing verified bootstrap links Telegram users; no new linking/merge/handoff or matching by name.

Own context and visible guest list/detail refresh every five seconds, visibility/online/pageshow and BroadcastChannel invalidation. This hint never carries credentials or authoritative ownership. No localStorage auth/reservation tokens or fictional data. Background updates do not insert loading rows. Pagination preserved when list revision is unchanged. One Telegram Back handler per page delegates to active dialog and refuses closing while pending; native dialog focus and Escape use same guard. Russian reservation resources are in `src/lib/reservation-copy.ts`.

Analytics `gift_reserved` / `gift_unreserved` is atomic on actual changes, once per operation. It records event only: no guest/user identity or gift mapping in properties, protecting Surprise. No new notifications or bot delivery are activated.

## Verification

Local tests: 42 tests across 18 files, including real handlers through PGlite/PostgreSQL migrations/fe_server: names, strict ownership fields, CSRF, event/gift chain, own refresh, same-name isolation, duplicate receipts/conflict, Surprise public/private projection, exact stale cancellation, 102-record private pagination, revoked session and injected failure rollback of name/reservation/receipt/analytics. Existing slice tests retained. Lint, build and clean migration/21-table tests are run before publication.

Hosted script `scripts/reservation-smoke.ts` targets existing staging only, uses actual HTTP/API sessions/CSRF plus a restricted PostgreSQL connection pool with independent connections. It exercises actual simultaneous HTTP and DB reserve, reserve/cancel, reserve/Gift delete, reserve/Event delete, privacy, session expiry/revocation/restart, receipt replay, stale cancellation and analytics. Synthetic marker/time/random Telegram identity scoped cleanup; real user data not changed. Final hosted results and browser observations are appended after execution.

## Ручная проверка на iPhone

Подготовка: создайте отдельное тестовое событие с тремя свободными подарками. Скопируйте публичную ссылку. Контекст A — обычный Safari; B — приватный Safari либо другой браузер/устройство. Две обычные вкладки Safari используют одну сессию и не являются разными гостями.

1. **Просмотр без регистрации.** A: публичное событие → wishlist → детали. Ожидание: реальные сведения, вертикальное фото, «Свободен» и действие выбора; нет обязательного входа.
2. **Выбор без RSVP.** Нажмите «Выбрать», введите имя 2–60 символов и подтвердите. Ожидание: имя проверяется, после сервера «Вы выбрали этот подарок» / «Отменить выбор». В Guest List не возникает RSVP от этой операции.
3. **Refresh и повторное открытие.** Обновите список и детали, закройте и откройте приглашение в том же Safari. Ожидание: собственный выбор узнаётся без повторного имени.
4. **Другой Guest.** B: та же ссылка. Ожидание: «Уже выбран», без имени гостя A и возможности отмены. Совпадающее имя не даёт владения.
5. **Отмена с confirmation.** A: «Отменить выбор» → «Оставить выбор». Ожидание: бронь сохраняется. Повторите и подтвердите отмену: подарок становится свободным, после refresh и в B тоже.
6. **RSVP и повторный выбор.** A: отправьте RSVP, затем выберите другой подарок. Ожидание: повторного вопроса об имени нет; ответ/число гостей не меняются от брони. Существующие yes/no/maybe сохраняются.
7. **Гонка двух гостей.** A/B откройте один свободный подарок, затем одновременно выберите его. Ожидание: ровно один успех; второй получает «Этот подарок только что выбрал другой гость» и «Выбрать другой». Оба экрана сходятся к актуальному статусу.
8. **Organizer и Surprise.** При ON видны занятость и корректный счётчик, без имени выбравшего. После осознанного OFF разрешённое имя видно владельцу; гостям имена всё равно не показываются. Верните ON.
9. **Ошибки сети.** Отключите сеть: выбор/отмена disabled, сведения и имя сохранены. Верните сеть и повторите. При неизвестном результате используйте «Проверить результат»; дублей быть не должно.
10. **Удаление.** Удалите только тестовый занятый Gift с confirmation; он исчезает у гостей. Удалите тестовое Event: список и детали недоступны, открытые страницы обновляются без активных действий.
11. **Потерянная сессия.** Новый браузер не узнаёт анонимный выбор по имени. Не очищайте рабочие cookies ради теста: это необратимо лишит доступа к анонимным данным. Expiry/revocation/restart проверяются изолированным автоматическим сценарием; при потерянной session интерфейс объясняет ограничение и требует явного нового гостевого контекста.
12. **Telegram и PWA.** Повторите выбор/refresh/отмену на тестовом подарке в Mini App и установленной PWA. Проверьте safe-area, клавиатуру, длинное имя, прокрутку диалога и Back/Escape. Анонимная PWA может иметь отдельное хранилище cookies; одинаковое имя не связывает устройства.

Физический iPhone, установленная PWA и реальный Telegram проходятся пользователем; автоматические проверки не заменяют эти взаимодействия. Не присылайте cookies/initData/секреты.
