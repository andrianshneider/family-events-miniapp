"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { eventWhen, telegramShareUrl, type Invitation } from "@/lib/invitation";
import { nativeShare, copyInvitation } from "@/lib/share-actions";
import { watchEventChanges } from "@/lib/event-updates";
import { TelegramBack } from "./telegram-back";
export function ShareEventScreen({
  eventId,
  initial,
}: {
  eventId: string;
  initial: Invitation;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial),
    [unavailable, setUnavailable] = useState(false),
    [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(false),
    [action, setAction] = useState<"copy" | "share" | null>(null),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("");
  const input = useRef<HTMLInputElement>(null),
    shareButton = useRef<HTMLButtonElement>(null),
    busy = useRef(false),
    flight = useRef(false),
    last = useRef(0);
  const restoreShareFocus = useRef(false);
  useEffect(() => {
    if (action === null && restoreShareFocus.current) {
      restoreShareFocus.current = false;
      shareButton.current?.focus();
    }
  }, [action]);
  const loginPath =
    "/login?returnTo=" + encodeURIComponent(`/events/${eventId}/share`);
  const refresh = useCallback(async () => {
    if (flight.current || busy.current || !navigator.onLine) return;
    flight.current = true;
    setPending(true);
    try {
      const response = await fetch(`/api/v1/events/${eventId}/share`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401) {
        setUnavailable(true);
        window.location.replace(loginPath);
        return;
      }
      if (response.status === 404) {
        setUnavailable(true);
        return;
      }
      if (!response.ok) throw Error();
      setData((await response.json()).data);
      setError("");
    } catch {
      setError(
        "Не удалось обновить приглашение. Показана ранее загруженная ссылка; проверьте соединение.",
      );
    } finally {
      flight.current = false;
      last.current = Date.now();
      setPending(false);
    }
  }, [eventId, loginPath]);
  useEffect(() => {
    const network = () => setOffline(!navigator.onLine);
    network();
    const restore = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - last.current > 1000
      )
        void refresh();
    };
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) restore();
    };
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("online", restore);
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", show);
    const interval = window.setInterval(restore, 15000),
      stop = watchEventChanges(restore);
    return () => {
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("online", restore);
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", show);
      window.clearInterval(interval);
      stop();
    };
  }, [refresh]);
  async function copy() {
    if (busy.current) return;
    busy.current = true;
    setAction("copy");
    setFeedback("");
    setError("");
    try {
      await copyInvitation(data.publicUrl, navigator.clipboard);
      setFeedback("Ссылка скопирована");
    } catch {
      setError(
        "Не удалось скопировать автоматически. Ссылка выделена — скопируйте её вручную.",
      );
      input.current?.focus();
      input.current?.select();
    } finally {
      busy.current = false;
      setAction(null);
    }
  }
  async function share() {
    if (busy.current || offline) return;
    busy.current = true;
    setAction("share");
    setFeedback("");
    setError("");
    try {
      const app = (
        window as Window & {
          Telegram?: {
            WebApp?: {
              initData?: string;
              openTelegramLink?: (url: string) => void;
            };
          };
        }
      ).Telegram?.WebApp;
      const result = await nativeShare(data, {
        share: navigator.share?.bind(navigator),
        telegram: app?.initData ? app : undefined,
      });
      if (result === "unsupported")
        setFeedback(
          "Системное меню отправки недоступно. Скопируйте ссылку или откройте Telegram.",
        );
    } catch {
      setError(
        "Не удалось открыть отправку. Скопируйте ссылку или попробуйте Telegram.",
      );
    } finally {
      busy.current = false;
      restoreShareFocus.current = true;
      setAction(null);
    }
  }
  function telegram(e: React.MouseEvent<HTMLAnchorElement>) {
    if (offline || busy.current || pending) {
      e.preventDefault();
      return;
    }
    const app = (
      window as Window & {
        Telegram?: {
          WebApp?: {
            initData?: string;
            openTelegramLink?: (url: string) => void;
          };
        };
      }
    ).Telegram?.WebApp;
    if (app?.initData && app.openTelegramLink) {
      e.preventDefault();
      app.openTelegramLink(telegramShareUrl(data));
    }
  }
  return (
    <main className="shell event-shell share-shell">
      <TelegramBack onBack={() => router.push(`/events/${eventId}`)} />
      <header className="top">
        <div className="brand">
          <span aria-hidden="true">♡</span>Family Events
        </div>
      </header>
      <Link className="text-button back" href={`/events/${eventId}`}>
        ← К событию
      </Link>
      {unavailable ? (
        <>
          <h1>Событие недоступно</h1>
          <p>Оно удалено или у вас нет доступа.</p>
          <Link href="/events" className="secondary route-link">
            Мои события
          </Link>
        </>
      ) : (
        <>
          <h1>Поделиться приглашением</h1>
          <p className="muted">
            Отправьте близким одну ссылку. Они откроют событие без регистрации.
          </p>
          {offline && (
            <p className="notice" role="status">
              Нет соединения. Сохранённую ссылку можно скопировать; актуальность
              события проверим после подключения.
            </p>
          )}
          {error && (
            <div className="notice error" role="alert">
              <p>{error}</p>
              <button
                className="secondary"
                disabled={pending || !!action || offline}
                onClick={refresh}
              >
                Проверить приглашение
              </button>
            </div>
          )}
          {feedback && (
            <p className="notice success" role="status">
              {feedback}
            </p>
          )}
          {pending && <p role="status">Обновляем приглашение…</p>}
          <div className="invitation-layout" aria-busy={pending}>
            <section
              className="panel invitation-preview"
              aria-label="Предпросмотр приглашения"
            >
              <div className="event-cover public-cover">
                {data.event.coverUrl ? (
                  <Image
                    unoptimized
                    width={1000}
                    height={600}
                    src={data.event.coverUrl}
                    alt={`Обложка события «${data.event.title}»`}
                  />
                ) : (
                  <span aria-hidden="true">♡</span>
                )}
              </div>
              <h2>{data.event.title}</h2>
              <p>{eventWhen(data.event)}</p>
              <p className="timezone">Время события · {data.event.timezone}</p>
              {data.event.venueName && <p>{data.event.venueName}</p>}
            </section>
            <section
              className="invitation-controls"
              aria-label="Ссылка и отправка"
            >
              <label htmlFor="invitation-url">
                Постоянная ссылка на событие
              </label>
              <input
                ref={input}
                id="invitation-url"
                className="public-link"
                readOnly
                value={data.publicUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-describedby="invitation-hint"
              />
              <p id="invitation-hint" className="hint">
                Ссылка остаётся той же после редактирования. Её можно переслать
                другим гостям.
              </p>
              <div className="invitation-buttons" aria-busy={!!action}>
                <button
                  ref={shareButton}
                  className="primary"
                  disabled={!!action || pending || offline}
                  onClick={share}
                >
                  {action === "share" ? "Открываем отправку…" : "Поделиться"}
                </button>
                <button
                  className="secondary"
                  disabled={!!action || pending}
                  onClick={copy}
                >
                  {action === "copy" ? "Копируем…" : "Скопировать ссылку"}
                </button>
              </div>
              <a
                className="text-button telegram-share"
                href={telegramShareUrl(data)}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={offline || !!action || pending}
                onClick={telegram}
              >
                Отправить через Telegram ↗
              </a>
              <Link className="text-button" href={`/e/${data.event.publicId}`}>
                Посмотреть приглашение ↗
              </Link>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
