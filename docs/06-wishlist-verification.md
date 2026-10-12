# Срез 06 — Wishlist CRUD → публичный просмотр

12 октября 2026. Существующая ветка `infrastructure-foundation`, staging https://family-events-staging.vercel.app. `sources/` и Google Drive только для чтения. Production/main не изменяются.

## Источники и аудит

Использованы [основные требования](https://docs.google.com/document/d/10kmsdz5r4npcpg5MK0Yq_RgGFObfUTPpaAFT92nBvfc/edit), [PRD](https://docs.google.com/document/d/1fIecJjtJZKOtvpBx_uS6XVmKlwi6Fm-hUxmdbODAzRE/edit), [Technical Specification](https://docs.google.com/document/d/1HrYTqMQAW-82OZBLHN9VO3JrNzccGqR0QgHjMYiU39o/edit), актуальные spec/HTML 13–18 из [согласованной папки](https://drive.google.com/drive/folders/1ebHh9Y6BTHK9Y3TtJZBILIaSLYUfFepd), экраны 04/08/10 и отчёты 01–05.

| Критерий | Исходное состояние | Работа среза |
|---|---|---|
| Один wishlist / Event | создание в транзакции, UNIQUE event_id | переиспользовано, отдельные списки не создаются |
| Gifts | таблица, numeric(12,2), version, soft-delete, validation | реальные CRUD API, формы и owner screen |
| Брони | atomic DB reserve/cancel, unique active, история | безопасный read status, confirmation и atomic cancellation при delete |
| Surprise | default true в схеме; флаг в Management | реальное сохранение, конфликт версии и SQL projection |
| Фото | private Storage, upload/complete, sanitize/thumbnails/cleanup | привязка ready owned assets, public/owner gift-bound image proxy |
| Guest | только Event/RSVP | SSR wishlist/details, preview, навигация Event/RSVP success |

Макет 13 содержит предварительный лимит фото 5 МБ. Задание, Tech Spec и существующий upload используют **10 MiB / 20 MP**; интерфейс приведён к этому лимиту. Demo state switches/localStorage/reservations не перенесены. Экран 18 используется только для просмотра, reserve/cancel относятся к следующему срезу.

## Контракты и безопасность

- Organizer `/events/{eventId}/wishlist`; GET/PATCH `/api/v1/events/{eventId}/wishlist`; POST `/gifts`; GET/PATCH/DELETE `/gifts/{giftId}`. Публичные `/e/{publicId}/wishlist`, `/e/{publicId}/wishlist/{giftId}` и GET `/api/v1/public/events/{publicId}/wishlist`, `/gifts/{giftId}`.
- Поля Gift: title 2–120 Unicode codepoints после trim; URL optional HTTP/HTTPS без credentials; amount optional decimal string, >0, до двух знаков и 10 цифр целой части; currency RUB/EUR/USD только вместе с amount; comment ≤300 codepoints; imageAssetId optional. Blank values нормализуются, numeric не используется как float для расчётов; цена выводится строковым форматированием.
- Owner principal только из серверной сессии, цепочка Gift→Wishlist→Event проверяется независимо от client IDs. Чужое/удалённое — 404. Mutations требуют Origin/Organizer CSRF, idempotency key и distributed session limit 30/min (`GIFT_WRITE_RATE_LIMIT`). Public reads используют существующий 120/min/IP limiter; images — отдельный configurable `PUBLIC_MEDIA_RATE_LIMIT` 300/min/IP.
- Lock order Event→Gift→Reservation. Create/update/delete и `gift_created` выполняются транзакционно. Receipt не содержит reserver names/identities, поэтому replay старой мутации не раскрывает имя после включения Surprise. No-op edit не увеличивает gift version. Stable id/created_at, optimistic expectedVersion при edit/delete. Delete receipt повторяется после soft delete, включая последующее удаление Event.
- DELETE `{expectedVersion,confirmReserved:false}`; активная бронь → 409 `CONFIRM_RESERVED_GIFT_DELETE`. После отдельного confirmation `{confirmReserved:true}` атомарно выставляются Gift.deleted_at/version и reservation.cancelled/gift_deleted/version. Gift edit не освобождает бронь. При конфликте версии UI явно загружает актуальный Gift, не удаляет автоматически.
- Wishlist PATCH `{hideReserverIdentity,expectedVersion}` использует **существующую Event.version** под Event lock. Реальное изменение увеличивает Event.version и обновляет wishlist, без Event changes/notifications. Это сериализует вкладки и может корректно конфликтовать с параллельным Event edit. Не добавлялась несуществующая wishlist.version, миграций нет.
- Surprise ON SQL CASE не выбирает reserver display name в output; DTO не содержит reserverDisplayName. OFF owner получает только display name. Public всегда исключает name, reservation/guest/user/session IDs и owner imageAssetId. Public read не создаёт identities/sessions и не зависит от cookies. All dynamic DTO/images — private,no-store; noindex/nofollow сохраняются.
- Pagination `(sort_order,created_at,id)` с полными микросекундами PostgreSQL, limit 20/default, max50, cursor привязан к publicId/eventId. Общие counts не ограничены страницей. Видимые owner экраны обновляются раз в 5 секунд, public — 30 секунд и при возврате/online; локальный BroadcastChannel — только hint. Неизменившаяся ревизия сохраняет дополнительные страницы, изменившаяся обновляет с первой страницы. Ревизия — opaque HMAC с namespace: учитывает версии всей истории броней, поэтому одинаковое число reserved не скрывает смену выбора. Только для Owner/Surprise OFF включается server-only источник display names; изменение имени не меняет публичную ревизию и не раскрывает скрытые имена.

## Изображения и UI

Ready image можно привязать только владельцу Event. Pending/deleted/foreign отклоняются. Existing серверный pipeline проверяет content format, размер/пиксели, статичность, перекодирует в WebP и удаляет EXIF. UI поддерживает выбор, замену и удаление; ошибки сохраняют старый Gift и введённые поля. Upload retry сначала проверяет тот же prepared asset после неизвестного результата, повторное complete безопасно. Нет скачивания по gift URL.

Owner/public `/gifts/{giftId}/image` проверяют конкретную цепочку активных сущностей и ready owned asset; выдаётся bounded WebP до640px из thumbnail (fallback sanitized original), bucket остаётся private. Generic owner media endpoint исправлен: asset, закреплённый только за удалёнными Event/Gift, недоступен; другой active attachment сохраняет доступ. Unattached ready asset владельца остаётся доступен для preview до save. Shared images не удаляются mutation; используется существующий orphan cleanup с 24h grace, новый scheduler не активирован. Старый внешний кеш/ранее выданный короткоживущий signed URL нельзя мгновенно отозвать.

Новые статические UI-тексты вынесены в `src/lib/wishlist-copy.ts` (русский MVP catalog); сетевые/JSON ошибки приводятся к русскому пояснению, сохраняя известные server error codes.

Формы/read screens имеют empty/loading/error/retry/offline, disabled pending, version conflict, безопасный повтор неизвестного результата, safe-area, Telegram BackButton и native dialog. После 401/404 очищаются private list и поля открытого диалога; login returnTo принимает только точный owner wishlist path. Focus восстанавливается на доступное действие. Источники показывают reserve/cancel; в продукте этого среза соответствующих рабочих кнопок нет. Public preview и RSVP success ведут в настоящий wishlist.

`gift_created` пишет существующую server analytics в той же транзакции и не дублируется при replay. Existing visitor event ingestion для `wishlist_opened` отсутствует; отдельный tracker/guest identity ради просмотра не создавался. Полная воронка остаётся последующим analytics срезом. Telegram delivery, linking/merge, reserve/cancel UI, платежи и scraping не активируются.

## Проверки

Локально: 40 тестов в 17 файлах, types/lint/build, clean migrations/21 tables/grants и проверка server secrets в browser chunks. `tests/wishlist-slice.test.ts` вызывает actual API/services с PostgreSQL PGlite/fe_server: boundaries, CSRF, owner chain, idempotency/no-op/version, Surprise ON/OFF/public projection и SSR, image guards/proxy, shared media, confirmation, rollback gift+reservation+receipt при injected failure, pagination с микросекундами, закрытие после deletion и returnTo. `tests/gift-upload.test.ts` проверяет lost PUT response, same prepared asset, incomplete upload retry, invalid image failure и русские transport errors. Existing media/auth/Event/public/RSVP тесты сохраняются.

`scripts/wishlist-smoke.ts` ограничен существующим staging/ref и synthetic fixtures. Проверяет реальные HTTP/SSR/БД/Storage, сохранение всех полей, anonymous reads без bootstrap, повтор/конфликт, Surprise, запрещённые attachments/content/size/pixels, confirmation, shared image, actual parallel edit/reserve-delete, pagination, deleted routes. Cleanup scoped по random synthetic Telegram ID, marker и created_at: собственные файлы/children/events/users/guest fixture; пользовательские данные не затрагиваются. Скрипт соблюдает существующий write limiter, не повышая его для проверки.

### Итог публикации и hosted проверки

Implementation `a21a698` опубликован в `infrastructure-foundation`. [Preview 5GTbLmwXppjD9WRPYUFqR2mPcoEg](https://vercel.com/ast-dbae/family-events-miniapp/5GTbLmwXppjD9WRPYUFqR2mPcoEg) — READY, target=Preview, оба aliases включают `family-events-staging.vercel.app` и branch Preview. Оба CI прошли: [push](https://github.com/andrianshneider/family-events-miniapp/actions/runs/38226742017), [PR](https://github.com/andrianshneider/family-events-miniapp/actions/runs/38226934850).

Hosted wishlist smoke завершился с кодом 0 после cleanup; дополнительный запуск подтвердил actual Gift edit/delete и Gift create/Event delete races. Проверены реальные HTTP/SSR/API/БД/Storage: minimal/full Gift, цены/валюты/комментарии, ready/pending/foreign assets, content/size/pixel checks, image replacement/removal, Surprise и DTO/SSR privacy, version/idempotency/no-op, confirmation и reservation cancellation, shared media, complete microsecond pagination, parallel edits/reserve-delete и deleted routes. Restricted LOGIN `fe_app_login` проверен по членству в `fe_server`, без superuser/bypassrls; первый smoke guard исправлен с ошибочного сравнения имени LOGIN с group role.

Регрессии create/edit/delete/public/Share/OG/Storage, RSVP/Guest Session/Guest List, auth/refresh/expiry/logout/relogin и infrastructure завершились с кодом 0 после cleanup. Create-event smoke обновлён под согласованный публичный preview Gift: Gift ID допустим в gift link/DTO, но остаётся исключённым из PublicEventDTO; user/guest/wishlist IDs и reserver names по-прежнему исключены из public SSR/DTO.

Удалены только synthetic fixtures и их Storage originals/thumbnails/pending файлы; пользовательские данные не менялись. Нет новых миграций/ресурсов, main merge, Production deploy или Telegram delivery. Physical iPhone/Safari/PWA/Telegram и browser interactions не подтверждаются HTTP/SSR тестом. В этом запуске браузер был повторно проверен: admin-enforced policy verification unavailable; обход не использовался. Ручной сценарий ниже закрывает доступные пользователю platform/visual проверки.

## Ручной сценарий iPhone

1. Organizer откройте тестовое событие → «Управлять wishlist». Ожидание: пустой список, Surprise ON, «Добавить подарок», возврат к событию.
2. Добавьте подарок только с названием. Ожидание: сохранение без optional fields, одна карточка и корректный count; refresh сохраняет результат.
3. Добавьте подарок с фото, URL, ценой/валютой и многострочным комментарием. Ожидание: реальные фото/сведения после refresh, русская форма, цена без потери копеек.
4. Проверьте короткое/длинное название, цену 0/отрицательную/с >2 знаками, URL javascript/data и комментарий >300. Ожидание: ошибка и сохранённые поля; дубля нет.
5. Редактируйте подарок, оставив фото прежним; затем замените, затем уберите фото. Ожидание: сохранение каждого состояния после refresh. Неверное фото не уничтожает прежнее. Лимит — 10 MiB /20 MP.
6. Выключите Surprise с пояснением и включите обратно. Ожидание: серверное сохранение и восстановление после refresh. При ошибке не показывается ложный успех.
7. Откройте публичную ссылку Event в Safari без входа → wishlist → Gift details. Ожидание: реальные карточки/optional fields/фото, внешний URL в новой вкладке, нет регистрации и reserve/cancel действий этого среза.
8. Ответьте RSVP и нажмите «Посмотреть wishlist» на success. Ожидание: переход в тот же список; ответ не теряется.
9. Откройте две вкладки Organizer и измените один Gift. Ожидание: сохранение первой версии, конфликт второй, явная загрузка актуальных данных без незаметной перезаписи.
10. Отключите сеть при форме/списке. Ожидание: offline пояснение, данные/поля сохраняются, mutations disabled. После подключения повтор доступен; неизвестный результат проверяется той же операцией.
11. Удалите свободный подарок: «Отмена» сохраняет его, подтверждение удаляет; refresh и публичная сторона больше его не показывают. Последний Gift → empty state.
12. Другим Organizer попробуйте прямой private URL первого события. Ожидание: недоступность, без данных. Выйдите при открытом private screen; после session check требуется login и возврат в wishlist.
13. Для списка >20 Gift проверьте «Показать ещё», возврат и обновление; все позиции достижимы. Без изменений polling не сбрасывает загруженные страницы.
14. Удалите только тестовое Event. Ожидание: wishlist/details/images закрыты, открытые страницы после refresh/возврата становятся недоступны.
15. Повторите основной сценарий в Mini App, Safari и установленной PWA: safe-area, клавиатура, прокрутка формы, длинные тексты, Back/Escape/VoiceOver и фото. Surprise с выбранными Gift и смена статуса перед удалением подтверждены synthetic DB smoke; public reserve/cancel появится в следующем срезе.

Не присылайте cookies, initData, upload credentials или персональные ответы для проверки.
