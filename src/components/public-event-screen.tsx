"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicEvent } from "@/lib/invitation";
import { EventInformation } from "./event-information";
import { watchEventChanges } from "@/lib/event-updates";
export function PublicEventScreen({
  initialEvent,
}: {
  initialEvent: PublicEvent;
}) {
  const [event, setEvent] = useState(initialEvent);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [offline, setOffline] = useState(false);
  const flight = useRef(false),
    last = useRef(0);
  const refresh = useCallback(async () => {
    if (flight.current || !navigator.onLine) return;
    flight.current = true;
    setPending(true);
    try {
      const response = await fetch(
        `/api/v1/public/events/${initialEvent.publicId}`,
        {
          cache: "no-store",
          credentials: "omit",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.status === 404) {
        setUnavailable(true);
        return;
      }
      if (!response.ok) throw Error();
      setEvent((await response.json()).data);
      setError("");
    } catch {
      setError(
        "Не удалось обновить приглашение. Ранее загруженные сведения остаются на экране.",
      );
    } finally {
      flight.current = false;
      last.current = Date.now();
      setPending(false);
    }
  }, [initialEvent.publicId]);
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
    window.addEventListener("online", restore);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", show);
    const interval = window.setInterval(restore, 30000);
    const stop = watchEventChanges(restore);
    return () => {
      window.removeEventListener("online", restore);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", show);
      window.clearInterval(interval);
      stop();
    };
  }, [refresh]);
  return (
    <main className="shell event-shell public-shell">
      <header className="top">
        <div className="brand">
          <span aria-hidden="true">♡</span>Family Events
        </div>
      </header>
      {unavailable ? (
        <>
          <h1>Это мероприятие недоступно</h1>
          <p>Уточните ссылку у отправителя.</p>
        </>
      ) : (
        <>
          {offline && (
            <p className="notice" role="status">
              Нет соединения. Показаны ранее загруженные сведения; актуальность
              приглашения проверим после подключения.
            </p>
          )}
          {error && (
            <div className="notice error" role="alert">
              <p>{error}</p>
              <button
                className="secondary"
                disabled={pending || offline}
                onClick={refresh}
              >
                Попробовать снова
              </button>
            </div>
          )}
          {pending && <p role="status">Обновляем приглашение…</p>}
          <div className="public-information" aria-busy={pending}>
            <EventInformation event={event} />
          </div>
          <footer className="public-footer">
            Личная встреча по приглашению
          </footer>
        </>
      )}
    </main>
  );
}
