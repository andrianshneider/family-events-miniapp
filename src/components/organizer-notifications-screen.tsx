"use client";
import { notificationText } from "@/lib/organizer-notifications-copy";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrganizerNotifications } from "@/lib/organizer-notifications";
import {
  wishlistApi,
  organizerMutation,
  WishlistError,
} from "@/lib/wishlist-client";
import { TelegramBack } from "./telegram-back";
import { announceEventChange } from "@/lib/event-updates";
type TelegramApp = {
  initData?: string;
  requestWriteAccess?: (callback: (allowed: boolean) => void) => void;
  openTelegramLink?: (url: string) => void;
};
const telegram = () =>
  (window as Window & { Telegram?: { WebApp?: TelegramApp } }).Telegram?.WebApp;
export function OrganizerNotificationsScreen({
  eventId,
  initial,
}: {
  eventId: string;
  initial: OrganizerNotifications | null;
}) {
  const router = useRouter(),
    [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [notice, setNotice] = useState(""),
    [offline, setOffline] = useState(false),
    [url, setUrl] = useState(""),
    [attempt, setAttempt] = useState<{ key: string; enabled: boolean } | null>(
      null,
    );
  const lock = useRef(false),
    flight = useRef(false);
  const path = `/api/v1/events/${eventId}/notification-subscription`;
  const load = useCallback(async () => {
    if (flight.current || !navigator.onLine) return;
    flight.current = true;
    try {
      const result = await wishlistApi<OrganizerNotifications>(path);
      setData(result);
      setConnectionError("");
      if (result.enabled && result.channel === "ready") {
        setUrl("");
        setNotice(
          notificationText(
            "Telegram подключён. Новые и изменённые ответы гостей приходят вам.",
          ),
        );
      } else if (result.handoff?.state === "account_mismatch")
        setConnectionError(
          notificationText(
            "В Telegram открыт другой аккаунт. Подключите аккаунт Organizer; подписка не включена.",
          ),
        );
      else if (result.handoff?.state === "expired")
        setConnectionError(
          notificationText("Ссылка истекла. Создайте новое подключение."),
        );
    } catch (e) {
      if (e instanceof WishlistError && e.status === 401) {
        setData(null);
        setUrl("");
        window.location.replace(
          "/login?returnTo=" +
            encodeURIComponent(`/events/${eventId}/notifications`),
        );
      } else {
        if (e instanceof WishlistError && e.status === 404) {
          setData(null);
          setUrl("");
        }
        setConnectionError(
          e instanceof Error
            ? e.message
            : notificationText("Не удалось проверить подключение."),
        );
      }
    } finally {
      flight.current = false;
    }
  }, [eventId, path]);
  useEffect(() => {
    const network = () => setOffline(!navigator.onLine),
      restore = () => {
        if (document.visibilityState === "visible") void load();
      };
    network();
    restore();
    window.addEventListener("online", network);
    window.addEventListener("online", restore);
    window.addEventListener("offline", network);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", restore);
    const t = setInterval(restore, 5000);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", network);
      window.removeEventListener("online", restore);
      window.removeEventListener("offline", network);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [load]);
  async function toggle(enabled: boolean, retry = false) {
    if (lock.current || offline) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const op =
      retry && attempt ? attempt : { key: crypto.randomUUID(), enabled };
    setAttempt(op);
    try {
      await organizerMutation(path, "PUT", { enabled: op.enabled }, op.key);
      setAttempt(null);
      setNotice(
        op.enabled
          ? notificationText("Уведомления включены.")
          : notificationText("Уведомления выключены."),
      );
      await load();
      announceEventChange();
    } catch (e) {
      if (
        e instanceof WishlistError &&
        e.status < 500 &&
        e.code !== "REQUEST_IN_PROGRESS"
      )
        setAttempt(null);
      setError(
        e instanceof WishlistError
          ? e.message
          : notificationText(
              "Результат неизвестен. Проверьте сохранение той же операции.",
            ),
      );
      await load();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function connect() {
    if (lock.current || offline) return;
    if (data?.channel === "ready") {
      await toggle(true);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const app = telegram(),
        mini = Boolean(app?.initData && app.requestWriteAccess);
      const h = await organizerMutation<{ telegramUrl: string }>(
        `/api/v1/events/${eventId}/notification-handoff`,
        "POST",
        { mode: mini ? "mini_app" : "bot_start" },
        crypto.randomUUID(),
      );
      setUrl(h.telegramUrl);
      setNotice(
        notificationText(
          "Разрешите сообщения в Telegram, затем вернитесь сюда. Проверим подключение на сервере.",
        ),
      );
      if (mini)
        app!.requestWriteAccess!(async (allowed) => {
          if (!allowed) {
            setNotice(
              notificationText(
                "Вы отказались от сообщений. Событие остаётся доступным.",
              ),
            );
            await toggle(false);
            return;
          }
          try {
            await organizerMutation(
              `/api/v1/events/${eventId}/notification-permission`,
              "POST",
              { initData: app!.initData },
              crypto.randomUUID(),
            );
          } catch {
            /* Client callback never grants server permission. Bot update or a signed Telegram claim must confirm it. */
          }
          await load();
        });
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : notificationText("Не удалось подготовить подключение."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="shell event-shell">
      <TelegramBack
        warnBeforeClose={busy || Boolean(attempt)}
        onBack={() => {
          if (!busy) router.push(`/events/${eventId}`);
        }}
      />
      <header className="top">
        <div className="brand">
          <span aria-hidden="true">♡</span>Family Events
        </div>
      </header>
      <Link className="text-button back" href={`/events/${eventId}`}>
        {notificationText("← К событию")}
      </Link>
      <h1>{notificationText("Уведомления в Telegram")}</h1>
      {data && <p>{data.eventTitle}</p>}
      {offline && (
        <p className="notice">
          {notificationText(
            "Нет соединения. Настройки доступны после подключения.",
          )}
        </p>
      )}
      {(error || connectionError) && (
        <p className="error" role="alert">
          {error || connectionError}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="panel" aria-busy={busy}>
        {data?.channel === "ready" ? (
          <>
            <h2>{notificationText("Бот подключён")}</h2>
            <label className="surprise-switch">
              <input
                type="checkbox"
                role="switch"
                checked={Boolean(data.enabled)}
                disabled={busy || offline || Boolean(attempt)}
                onChange={(e) => void toggle(e.target.checked)}
                aria-describedby="organizer-notify-description"
              />
              {notificationText("Новые ответы гостей")}
            </label>
            <p className="muted" id="organizer-notify-description">
              {notificationText(
                "Сообщения о новых и изменённых RSVP только этого события.",
              )}
            </p>
          </>
        ) : (
          <>
            <h2>
              {data?.channel === "blocked"
                ? notificationText("Бот заблокирован")
                : notificationText("Разрешите сообщения бота")}
            </h2>
            <p>
              {notificationText(
                "Разрешение включит уведомления о новых и изменённых ответах гостей этого события. Вход в аккаунт сам по себе не включает сообщения.",
              )}
            </p>
            {data?.channel === "blocked" && (
              <p>
                {notificationText(
                  "Разблокируйте бота в Telegram и разрешите сообщения заново.",
                )}
              </p>
            )}
            <button
              className="primary"
              disabled={busy || offline || !data || Boolean(attempt)}
              onClick={() => void connect()}
            >
              {busy
                ? notificationText("Подключаем…")
                : notificationText(
                    "Разрешить сообщения и включить уведомления",
                  )}
            </button>
          </>
        )}
        {url && (
          <>
            <p>
              {notificationText(
                "В боте нажмите «Запустить», используя тот же Telegram-аккаунт. Затем вернитесь на эту страницу.",
              )}
            </p>
            <a
              className="primary route-link"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                const app = telegram();
                if (app?.initData && app.openTelegramLink) {
                  e.preventDefault();
                  app.openTelegramLink(url);
                }
              }}
            >
              {notificationText("Открыть Telegram")}
            </a>
          </>
        )}
        <div className="gift-dialog-actions">
          <button
            className="secondary"
            disabled={busy || offline}
            onClick={() => void load()}
          >
            {notificationText("Проверить подключение")}
          </button>
          {attempt && (
            <button
              className="secondary"
              disabled={busy || offline}
              onClick={() => void toggle(attempt.enabled, true)}
            >
              {notificationText("Проверить сохранение")}
            </button>
          )}
          {data?.handoff?.state === "pending" && (
            <button
              className="secondary"
              disabled={busy || offline}
              onClick={() => void toggle(false)}
            >
              {notificationText("Отменить подключение")}
            </button>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>{notificationText("Какие сообщения придут")}</h2>
        <p>
          {notificationText("🎉 Новый ответ гостя — с переходом к событию.")}
        </p>
        <p>
          {notificationText(
            "🔄 Изменение ответа — с переходом к списку гостей.",
          )}
        </p>
        <p className="muted">
          {notificationText(
            "При выключенных уведомлениях или без разрешения сообщения не отправляются. Настройки можно изменить в любой момент.",
          )}
        </p>
      </section>
    </main>
  );
}
