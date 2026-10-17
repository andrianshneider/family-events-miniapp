"use client";
import {failure,telemetryHeaders} from "@/lib/analytics/client";
import { reservationText } from "@/lib/reservation-copy";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { Gift } from "@/lib/wishlist";
import type { ReservationContext, OwnReservation } from "@/lib/reservation";
import { wishlistApi, WishlistError } from "@/lib/wishlist-client";
import { reserveInput } from "@/lib/reservation-validation";
import { announceEventChange, watchEventChanges } from "@/lib/event-updates";
type Controller = {
  context: ReservationContext | null;
  busy: boolean;
  offline: boolean;
  error: string;
  select: (gift: Gift) => void;
  interceptBack: () => boolean;
  uncertain: boolean;
};
const Context = createContext<Controller | null>(null);
export const useReservations = () => useContext(Context);
type Attempt = {
  key: string;
  method: "POST" | "DELETE";
  body: { guestName?: string } | { reservationId: string };
  giftId: string;
};
export function ReservationProvider({
  publicId,
  children,
}: {
  publicId: string;
  children: React.ReactNode;
}) {
  const [context, setContext] = useState<ReservationContext | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [offline, setOffline] = useState(false),
    [selected, setSelected] = useState<{
      gift: Gift;
      own: OwnReservation | null;
    } | null>(null),
    [name, setName] = useState(""),
    [nameError, setNameError] = useState(""),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [opError, setOpError] = useState(""),
    [race, setRace] = useState(false),
    [done, setDone] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    origin = useRef<HTMLElement | null>(null),
    flight = useRef(false),
    queued = useRef(false),
    lock = useRef(false),
    current = useRef<ReservationContext | null>(null);
  const load = useCallback(
    async function refresh(): Promise<ReservationContext | null> {
      if (flight.current) {
        queued.current = true;
        return null;
      }
      if (!navigator.onLine) return null;
      flight.current = true;
      try {
        const first = await wishlistApi<ReservationContext>(
          `/api/v1/public/events/${publicId}/my-reservations`,
        );
        const records = [...first.reservations];
        let cursor = first.nextCursor;
        while (cursor) {
          const page = await wishlistApi<ReservationContext>(
            `/api/v1/public/events/${publicId}/my-reservations?cursor=${cursor}`,
          );
          if (page.contextKey !== first.contextKey)
            throw Error(
              reservationText(
                "Гостевая сессия изменилась. Повторите проверку.",
              ),
            );
          records.push(...page.reservations);
          cursor = page.nextCursor;
        }
        const result = { ...first, reservations: records, nextCursor: null };
        if (
          current.current?.sessionState === "active" &&
          current.current.contextKey !== result.contextKey
        ) {
          setSelected(null);
          setAttempt(null);
          setName("");
          dialog.current?.close();
        }
        current.current = result;
        setContext(result);
        setError("");
        return result;
      } catch (e) {
        if (
          e instanceof WishlistError &&
          (e.status === 401 || e.status === 404)
        ) {
          current.current = null;
          setContext(null);
          setSelected(null);
          setAttempt(null);
          dialog.current?.close();
        }
        setError(
          e instanceof Error
            ? e.message
            : reservationText("Не удалось проверить ваш выбор."),
        );
        return null;
      } finally {
        flight.current = false;
        if (queued.current) {
          queued.current = false;
          queueMicrotask(() => void refresh());
        }
      }
    },
    [publicId],
  );
  useEffect(() => {
    const network = () => setOffline(!navigator.onLine);
    const restore = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void load();
    };
    network();
    restore();
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("online", network);
    window.addEventListener("online", restore);
    window.addEventListener("offline", network);
    window.addEventListener("pageshow", restore);
    const timer = setInterval(restore, 5000),
      stop = watchEventChanges(restore);
    return () => {
      clearInterval(timer);
      stop();
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("online", network);
      window.removeEventListener("online", restore);
      window.removeEventListener("offline", network);
      window.removeEventListener("pageshow", restore);
    };
  }, [load]);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);
  function close() {
    if (lock.current || busy) return;
    if (
      attempt &&
      !window.confirm(
        reservationText(
          "Результат неизвестен. Закрыть окно и проверить список?",
        ),
      )
    )
      return;
    dialog.current?.close();
    setSelected(null);
    setAttempt(null);
    setOpError("");
    if (origin.current?.isConnected) origin.current.focus();
    void load();
    announceEventChange();
  }
  async function submit(choice = selected) {
    if (!choice || lock.current || offline) return;
    if (current.current?.sessionState === "lost") {
      setOpError(
        reservationText(
          "Гостевая сессия потеряна. Откройте приглашение на устройстве, где выбирали подарок. Восстановить выбор по имени нельзя.",
        ),
      );
      return;
    }
    const parsed = reserveInput.safeParse({
      guestName: name.trim() || undefined,
    });
    if (
      !attempt &&
      !choice.own &&
      !current.current?.defaultName &&
      (!parsed.success || !parsed.data.guestName)
    ) {
      setNameError(reservationText("Введите имя от 2 до 60 символов."));
      dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    setOpError("");
    setNameError("");
    let op = attempt;
    try {
      if (!op) {
        await wishlistApi("/api/guest/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        op = {
          key: crypto.randomUUID(),
          method: choice.own ? "DELETE" : "POST",
          giftId: choice.gift.id,
          body: choice.own
            ? { reservationId: choice.own.reservationId }
            : current.current?.defaultName
              ? {}
              : { guestName: name.trim() },
        };
        setAttempt(op);
      } else {
        const state = await load();
        if (!state)
          throw Error(
            reservationText(
              "Не удалось проверить результат. Повторите попытку.",
            ),
          );
        if (state.sessionState !== "active")
          throw new WishlistError(
            401,
            "GUEST_SESSION_LOST",
            reservationText("Гостевая сессия потеряна."),
          );
        const own = state.reservations.find((r) => r.giftId === op!.giftId);
        if (
          (op.method === "POST" && own) ||
          (op.method === "DELETE" &&
            !state.reservations.some(
              (r) =>
                r.reservationId ===
                (op!.body as { reservationId: string }).reservationId,
            ))
        ) {
          setAttempt(null);
          setDone(true);
          setNotice(
            op.method === "POST"
              ? reservationText("Вы выбрали этот подарок.")
              : reservationText("Выбор отменён."),
          );
          announceEventChange();
          return;
        }
      }
      const csrf = await wishlistApi<{ csrfToken: string }>(
        "/api/auth/csrf?context=guest",
      );
      const response = await wishlistApi<{
        reservation?: OwnReservation;
        cancelled?: boolean;
      }>(`/api/v1/public/events/${publicId}/gifts/${op.giftId}/reservation`, {
        method: op.method,
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf.csrfToken,
          "idempotency-key": op.key,
          ...telemetryHeaders(op.key),
        },
        body: JSON.stringify(op.body),
      });
      const verified = await load();
      if (!verified)
        throw Error(reservationText("Не удалось проверить актуальный выбор."));
      if (verified.sessionState !== "active")
        throw new WishlistError(
          401,
          "GUEST_SESSION_LOST",
          reservationText("Гостевая сессия потеряна."),
        );
      setAttempt(null);
      setDone(true);
      setNotice(
        op.method === "DELETE"
          ? reservationText("Выбор отменён.")
          : verified.reservations.some(
                (r) => r.reservationId === response.reservation?.reservationId,
              )
            ? reservationText("Вы выбрали этот подарок.")
            : reservationText("Бронь больше не активна. Список обновлён."),
      );
      announceEventChange();
    } catch (e) {
      if(op?.method==="POST")failure("gift_reserve",op.key,{kind:"public",id:publicId},e);
      if (
        e instanceof WishlistError &&
        e.status < 500 &&
        ![408].includes(e.status) &&
        e.code !== "REQUEST_IN_PROGRESS"
      ) {
        setAttempt(null);
        if (e.code === "GIFT_ALREADY_RESERVED") {
          setRace(true);
          await load();
          announceEventChange();
        }
        if (e.status === 401) {
          setName("");
          current.current = null;
          setContext(null);
          await load();
        }
        if (e.status === 404) {
          await load();
          announceEventChange();
        }
        setOpError(e.message);
      } else
        setOpError(
          reservationText(
            "Результат пока неизвестен. Нажмите «Проверить результат»: проверим сервер и безопасно повторим ту же операцию.",
          ),
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function select(gift: Gift) {
    if (!context || busy || offline) return;
    const own = context.reservations.find((r) => r.giftId === gift.id) ?? null;
    if (gift.reserved && !own) return;
    origin.current = document.activeElement as HTMLElement;
    const choice = { gift, own };
    setSelected(choice);
    setName(context.defaultName ?? "");
    setNameError("");
    setOpError("");
    setNotice("");
    setRace(false);
    setDone(false);
    setAttempt(null);
    if (!own && context.defaultName && context.sessionState === "active")
      void submit(choice);
  }
  async function restart() {
    if (lock.current || offline) return;
    lock.current = true;
    setBusy(true);
    try {
      await wishlistApi("/api/guest/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart: true }),
      });
      await load();
      setOpError("");
      setAttempt(null);
      setSelected(null);
      dialog.current?.close();
    } catch (e) {
      setOpError(
        e instanceof Error
          ? e.message
          : reservationText("Не удалось начать новую сессию."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        context,
        busy,
        offline,
        error,
        select,
        uncertain: Boolean(attempt),
        interceptBack: () => {
          if (!selected) return false;
          close();
          return true;
        },
      }}
    >
      {children}
      {error && (
        <div className="shell error" role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            disabled={offline}
            onClick={() => void load()}
          >
            {reservationText("Проверить выбор снова")}
          </button>
        </div>
      )}
      {context?.sessionState === "lost" && (
        <div className="shell notice">
          <p>
            {reservationText(
              "Гостевая сессия потеряна. Откройте приглашение на устройстве, где выбирали подарок. Восстановить бронь по имени нельзя.",
            )}
          </p>
          <button
            className="secondary"
            disabled={busy || offline}
            onClick={() => void restart()}
          >
            {reservationText("Продолжить как новый гость")}
          </button>
        </div>
      )}
      {notice && (
        <p className="shell notice" role="status">
          {notice}
        </p>
      )}
      <dialog
        ref={dialog}
        className="rsvp-dialog"
        aria-labelledby="reservation-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        {selected && (
          <>
            <h2 id="reservation-title">
              {done
                ? notice
                : selected.own
                  ? reservationText("Отменить выбор?")
                  : context?.defaultName
                    ? reservationText("Выбрать подарок")
                    : reservationText("Как вас зовут?")}
            </h2>
            <p>{selected.gift.title}</p>
            {!selected.own && !done && (
              <p>
                {reservationText(
                  "Выбор подарка — это бронь, а не покупка или оплата.",
                )}
              </p>
            )}
            {selected.own && !done && (
              <p>
                {reservationText(
                  "Подарок снова станет свободным для других гостей.",
                )}
              </p>
            )}
            {!selected.own && !context?.defaultName && !done && !race && (
              <label className="field reservation-name">
                {reservationText("Ваше имя")}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy || Boolean(attempt)}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby="reservation-name-error"
                  autoComplete="name"
                />
                <span id="reservation-name-error" className="error">
                  {nameError}
                </span>
              </label>
            )}
            {opError && (
              <p className="error" role="alert">
                {opError}
              </p>
            )}
            {offline && (
              <p className="notice">
                {reservationText(
                  "Нет соединения. Выбор и отмена доступны после подключения.",
                )}
              </p>
            )}
            {context?.sessionState === "lost" && (
              <button
                className="secondary"
                disabled={busy || offline}
                onClick={() => void restart()}
              >
                {reservationText("Продолжить как новый гость")}
              </button>
            )}
            <div className="gift-dialog-actions" aria-busy={busy}>
              {race ? (
                <Link
                  className="primary"
                  href={`/e/${publicId}/wishlist`}
                  onClick={close}
                >
                  {reservationText("Выбрать другой")}
                </Link>
              ) : (
                !done && (
                  <button
                    className="primary"
                    disabled={
                      busy || offline || context?.sessionState === "lost"
                    }
                    onClick={() => void submit()}
                  >
                    {busy
                      ? reservationText("Сохраняем…")
                      : attempt
                        ? reservationText("Проверить результат")
                        : selected.own
                          ? reservationText("Отменить выбор")
                          : reservationText("Выбрать подарок")}
                  </button>
                )
              )}
              {done ? (
                <Link
                  className="secondary"
                  href={`/e/${publicId}/wishlist`}
                  onClick={close}
                >
                  {reservationText("К wishlist")}
                </Link>
              ) : (
                <button className="secondary" disabled={busy} onClick={close}>
                  {selected.own
                    ? reservationText("Оставить выбор")
                    : reservationText("Отмена")}
                </button>
              )}
            </div>
          </>
        )}
      </dialog>
    </Context.Provider>
  );
}
export function ReservationAction({
  gift,
  detail = false,
}: {
  gift: Gift;
  detail?: boolean;
}) {
  const state = useReservations();
  if (!state) return null;
  const own = state.context?.reservations.some((r) => r.giftId === gift.id);
  return (
    <div className="gift-actions">
      <button
        className={own ? "secondary" : "primary"}
        disabled={
          !state.context ||
          Boolean(state.error) ||
          state.busy ||
          state.offline ||
          (gift.reserved && !own)
        }
        onClick={() => state.select(gift)}
      >
        {!state.context
          ? reservationText("Проверяем выбор…")
          : own
            ? reservationText("Отменить выбор")
            : gift.reserved
              ? reservationText("Уже выбран")
              : detail
                ? reservationText("Выбрать этот подарок")
                : reservationText("Выбрать")}
      </button>
    </div>
  );
}
