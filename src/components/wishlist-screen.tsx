"use client";
import { useAnalyticsError, useAnalyticsView } from "@/lib/analytics/client";
import { wishlistText } from "@/lib/wishlist-copy";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Gift, Wishlist } from "@/lib/wishlist";
import {
  useWishlist,
  organizerMutation,
  wishlistApi,
  WishlistError,
} from "@/lib/wishlist-client";
import { announceEventChange } from "@/lib/event-updates";
import { ReservationAction, useReservations } from "./reservation-provider";
import { GiftCard } from "./gift-card";
import { GiftForm } from "./gift-form";
import { TelegramBack } from "./telegram-back";
type Operation = {
  path: string;
  method: string;
  body: unknown;
  key: string;
  kind: "toggle" | "delete";
};
export function WishlistScreen({
  eventKey,
  owner = false,
  initial = null,
  preview = false,
}: {
  eventKey: string;
  owner?: boolean;
  initial?: Wishlist | null;
  preview?: boolean;
}) {
  const router = useRouter();
  const reservations = useReservations();
  const { data, pending, error, offline, unavailable, load, clear } =
    useWishlist(eventKey, owner, initial, preview);
  const [editing, setEditing] = useState<Gift | null | undefined>(undefined),
    [deleting, setDeleting] = useState<Gift | null>(null),
    [busy, setBusy] = useState(false),
    [opError, setOpError] = useState(""),
    [notice, setNotice] = useState(""),
    [attempt, setAttempt] = useState<Operation | null>(null),
    [confirmedReserved, setConfirmedReserved] = useState(false),
    [deleteConflict, setDeleteConflict] = useState(false),
    [formUncertain, setFormUncertain] = useState(false);
  const screen = useRef<HTMLElement>(null);
  useAnalyticsError("wishlist_view", unavailable || (!!error && !data), {
    kind: owner ? "management" : "public",
    id: eventKey,
  });
  const analyticsPreview = useAnalyticsView(
    "wishlist_viewed",
    { kind: owner ? "management" : "public", id: eventKey },
    {
      surface: owner ? "management" : preview ? "preview" : "full",
      is_empty: data?.total === 0,
    },
    !!data && !unavailable,
    preview,
  );
  const dialog = useRef<HTMLDialogElement>(null),
    origin = useRef<HTMLElement | null>(null),
    locking = useRef(false);
  useEffect(() => {
    if (unavailable) dialog.current?.close();
  }, [unavailable]);
  const base = `/api/v1/events/${eventKey}`,
    back = `/${owner ? "events" : "e"}/${eventKey}`;
  function auth() {
    clear();
    dialog.current?.close();
    window.location.replace(
      "/login?returnTo=" + encodeURIComponent(`/events/${eventKey}/wishlist`),
    );
  }
  function close() {
    if (locking.current || busy) return;
    if (
      (attempt || formUncertain) &&
      !window.confirm(
        wishlistText("Результат неизвестен. Закрыть форму и проверить список?"),
      )
    )
      return;
    dialog.current?.close();
    setFormUncertain(false);
    void load();
    setEditing(undefined);
    setDeleting(null);
    setOpError("");
    setAttempt(null);
    if (origin.current?.isConnected) origin.current.focus();
  }
  function open(gift: Gift | null, remove = false) {
    origin.current = document.activeElement as HTMLElement;
    setOpError("");
    setAttempt(null);
    setConfirmedReserved(Boolean(gift?.reserved));
    setDeleteConflict(false);
    setFormUncertain(false);
    if (remove) setDeleting(gift);
    else setEditing(gift);
    dialog.current?.showModal();
  }
  async function run(op: Operation) {
    if (locking.current || offline) return;
    locking.current = true;
    setBusy(true);
    setOpError("");
    let unknown = true;
    try {
      setAttempt(op);
      await organizerMutation(op.path, op.method, op.body, op.key);
      setAttempt(null);
      setNotice(
        op.kind === "delete"
          ? wishlistText("Подарок удалён.")
          : wishlistText("Настройка сохранена."),
      );
      announceEventChange();
      if (op.kind === "delete") {
        dialog.current?.close();
        setDeleting(null);
      }
      await load();
    } catch (caught) {
      if (caught instanceof WishlistError) {
        if (caught.status === 401) {
          auth();
          return;
        }
        if (
          [400, 403, 404, 422, 429].includes(caught.status) ||
          ["VERSION_CONFLICT", "CONFIRM_RESERVED_GIFT_DELETE"].includes(
            caught.code,
          )
        ) {
          setAttempt(null);
          unknown = false;
        }
        if (caught.code === "CONFIRM_RESERVED_GIFT_DELETE")
          setConfirmedReserved(true);
        if (caught.code === "VERSION_CONFLICT") {
          if (op.kind === "delete") setDeleteConflict(true);
          await load();
        }
      }
      setOpError(
        unknown
          ? wishlistText(
              "Результат пока неизвестен. Проверьте сохранение повтором той же операции.",
            )
          : caught instanceof Error
            ? caught.message
            : wishlistText("Не удалось сохранить изменения."),
      );
    } finally {
      locking.current = false;
      setBusy(false);
    }
  }
  function toggle() {
    if (!data || data.version == null) return;
    const target = !data.hideReserverIdentity;
    if (
      !target &&
      !window.confirm(
        wishlistText(
          "Выключить режим сюрприза? Имена выбравших подарки станут видны вам; другие гости их не увидят.",
        ),
      )
    )
      return;
    void run({
      path: base + "/wishlist",
      method: "PATCH",
      body: { hideReserverIdentity: target, expectedVersion: data.version },
      key: crypto.randomUUID(),
      kind: "toggle",
    });
  }
  const disabled = busy || pending || offline || Boolean(attempt),
    showName = !data?.hideReserverIdentity && !busy && !attempt;
  const content = unavailable ? (
    <>
      <h1>{wishlistText("Это мероприятие недоступно")}</h1>
      <p>{wishlistText("Событие удалено или у вас нет доступа.")}</p>
    </>
  ) : (
    <>
      {!preview && (
        <>
          <Link className="text-button back" href={back}>
            {wishlistText("← К событию")}
          </Link>
          <h1>
            {owner ? wishlistText("Вишлист") : wishlistText("Что подарить")}
          </h1>
          {data && <p>{data.event.title}</p>}
        </>
      )}
      {offline && (
        <p className="notice" role="status">
          {wishlistText(
            "Нет соединения. Ранее загруженные данные могут быть неактуальны.",
          )}
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            disabled={pending || offline}
            onClick={() => load()}
          >
            {wishlistText("Попробовать снова")}
          </button>
        </div>
      )}
      {opError && !deleting && (
        <div className="error" role="alert">
          <p>{opError}</p>
          {attempt && (
            <button
              className="secondary"
              disabled={busy || offline}
              onClick={() => run(attempt)}
            >
              {wishlistText("Проверить сохранение")}
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {owner && data && (
        <section className="panel wishlist-settings">
          <label className="surprise-switch">
            <input
              type="checkbox"
              role="switch"
              checked={Boolean(data.hideReserverIdentity)}
              disabled={disabled || pending}
              onChange={toggle}
              aria-describedby="surprise-help"
            />
            {wishlistText("Скрывать, кто выбрал подарок")}
          </label>
          <p className="hint" id="surprise-help">
            {wishlistText("Вы увидите, что подарок выбран, но не узнаете кем.")}
          </p>
          {busy && <p role="status">{wishlistText("Сохраняем…")}</p>}
        </section>
      )}
      {data && owner && (
        <div className="wishlist-toolbar">
          <p>
            {wishlistText("Подарков: ")}
            {data.total}
            {wishlistText(" · Выбрано: ")}
            {data.reservedTotal}
          </p>
          <button
            className="primary"
            disabled={disabled}
            onClick={() => open(null)}
          >
            {wishlistText("+ Добавить подарок")}
          </button>
        </div>
      )}
      {pending && !data && (
        <p role="status">{wishlistText("Загружаем wishlist…")}</p>
      )}
      {data && (
        <>
          {preview && <h2>{wishlistText("Что подарить")}</h2>}
          <div className="gift-grid" aria-busy={pending}>
            {data.gifts.map((g) => (
              <GiftCard
                key={g.id}
                gift={g}
                publicId={owner ? undefined : eventKey}
                showName={showName && owner}
                actions={
                  owner ? (
                    <div className="gift-actions">
                      <button
                        className="secondary"
                        disabled={disabled}
                        aria-label={wishlistText("Редактировать подарок: {0}", [
                          g.title,
                        ])}
                        onClick={() => open(g)}
                      >
                        {wishlistText("Редактировать")}
                      </button>
                      <button
                        className="text-button"
                        disabled={disabled}
                        aria-label={wishlistText("Удалить подарок: {0}", [
                          g.title,
                        ])}
                        onClick={() => open(g, true)}
                      >
                        {wishlistText("Удалить")}
                      </button>
                    </div>
                  ) : !preview ? (
                    <ReservationAction gift={g} />
                  ) : undefined
                }
              />
            ))}
          </div>
          {!data.total && !owner && (
            <section className="panel">
              <h2>{wishlistText("Wishlist пока пуст")}</h2>
              <p>{wishlistText("Организатор ещё не добавил идеи подарков.")}</p>
            </section>
          )}
          {!preview && data.nextCursor && (
            <button
              className="secondary"
              disabled={pending || offline || busy}
              onClick={() => load(true)}
            >
              {wishlistText("Показать ещё")}
            </button>
          )}
          {preview && (
            <Link
              className="secondary route-link"
              href={`/e/${eventKey}/wishlist`}
            >
              {wishlistText("Посмотреть wishlist")}
            </Link>
          )}
        </>
      )}
    </>
  );
  if (preview)
    return (
      <section ref={analyticsPreview} className="panel wishlist-preview">
        {content}
      </section>
    );
  return (
    <main ref={screen} className="shell event-shell wishlist-shell">
      <TelegramBack
        warnBeforeClose={
          busy ||
          Boolean(attempt) ||
          formUncertain ||
          reservations?.busy ||
          reservations?.uncertain
        }
        onBack={() => {
          if (reservations?.interceptBack()) return;
          if (busy) return;
          if (dialog.current?.open) close();
          else router.push(back);
        }}
      />
      <header className="top">
        <div className="brand">
          <span aria-hidden="true">♡</span>Family Events
        </div>
      </header>
      {content}
      <dialog
        ref={dialog}
        aria-labelledby="wishlist-dialog-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClose={() => {
          setEditing(undefined);
          setDeleting(null);
          setFormUncertain(false);
          setAttempt(null);
          if (origin.current?.isConnected) origin.current.focus();
          else
            screen.current
              ?.querySelector<HTMLElement>("button:not(:disabled), a")
              ?.focus();
        }}
      >
        {!unavailable && editing !== undefined && (
          <GiftForm
            key={editing?.id ?? "new"}
            eventId={eventKey}
            gift={editing}
            onAuth={auth}
            onBusy={setBusy}
            onUncertain={setFormUncertain}
            onClose={close}
            onSaved={() => {
              dialog.current?.close();
              setEditing(undefined);
              setNotice(wishlistText("Подарок сохранён."));
              announceEventChange();
              void load();
            }}
          />
        )}
        {!unavailable && deleting && (
          <>
            <h2 id="wishlist-dialog-title">
              {wishlistText("Удалить подарок?")}
            </h2>
            <p>{deleting.title}</p>
            <p>
              {wishlistText(
                "Подарок исчезнет из wishlist. Отменить удаление нельзя.",
              )}
            </p>
            {confirmedReserved && (
              <p className="notice">
                {wishlistText(
                  "Этот подарок уже выбрал один из гостей. Всё равно удалить его? Бронь будет аннулирована.",
                )}
              </p>
            )}
            {opError && (
              <p className="error" role="alert">
                {opError}
              </p>
            )}
            {deleteConflict && (
              <button
                className="secondary"
                disabled={busy || offline}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const current = await wishlistApi<Gift>(
                      base + `/gifts/${deleting.id}`,
                    );
                    setDeleting(current);
                    setConfirmedReserved(current.reserved);
                    setDeleteConflict(false);
                    setOpError("");
                  } catch (e) {
                    if (e instanceof WishlistError && e.status === 401) auth();
                    else
                      setOpError(
                        wishlistText(
                          "Не удалось загрузить подарок. Закройте диалог и повторите попытку.",
                        ),
                      );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {wishlistText("Загрузить актуальный подарок")}
              </button>
            )}
            <div className="gift-dialog-actions">
              <button
                className="primary danger"
                disabled={busy || offline || deleteConflict}
                onClick={() =>
                  run(
                    attempt ?? {
                      path: base + `/gifts/${deleting.id}`,
                      method: "DELETE",
                      body: {
                        expectedVersion: deleting.version,
                        confirmReserved: confirmedReserved,
                      },
                      key: crypto.randomUUID(),
                      kind: "delete",
                    },
                  )
                }
              >
                {busy
                  ? wishlistText("Удаляем…")
                  : attempt
                    ? wishlistText("Проверить сохранение")
                    : wishlistText("Удалить подарок")}
              </button>
              <button className="secondary" disabled={busy} onClick={close}>
                {wishlistText("Отмена")}
              </button>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
