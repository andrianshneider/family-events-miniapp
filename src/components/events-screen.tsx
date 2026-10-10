"use client";
import { InstallHelp } from "./install-help";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { readEventForm } from "@/lib/event-form-state";
type EventItem = {
  id: string;
  title: string;
  eventDate: string;
  startTime: string | null;
  timezone: string;
  venueName: string | null;
  coverUrl: string | null;
};
type Loaded = {
  name: string;
  events: EventItem[];
  nextCursor: string | null;
  resumeDraft: boolean;
};
export function EventsScreen() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const load = useCallback(async () => {
    try {
      const me = await fetch("/api/v1/me", { cache: "no-store" });
      if (me.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!me.ok)
        throw Error("Не удалось проверить сессию. Повторите попытку.");
      const profile = await me.json();
      const response = await fetch("/api/v1/events", { cache: "no-store" });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok)
        throw Error("Не удалось загрузить события. Повторите попытку.");
      const result = await response.json();
      let resumeDraft = false;
      try {
        const raw = localStorage.getItem("fe-create-event-form-v1");
        resumeDraft = !!readEventForm(raw, profile.data.id);
        if (raw && !resumeDraft)
          localStorage.removeItem("fe-create-event-form-v1");
      } catch {
        /* Temporary form storage is optional; the server remains authoritative. */
      }
      setData({
        name: profile.data.displayName,
        events: result.data.events,
        nextCursor: result.data.nextCursor,
        resumeDraft,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить события.",
      );
    } finally {
      setPending(false);
    }
  }, []);
  async function loadMore() {
    if (!data?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const response = await fetch(
        "/api/v1/events?cursor=" + encodeURIComponent(data.nextCursor),
        { cache: "no-store" },
      );
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok)
        throw Error(
          "Не удалось загрузить остальные события. Повторите попытку.",
        );
      const result = await response.json();
      setData(
        (current) =>
          current && {
            ...current,
            events: [
              ...current.events,
              ...result.data.events.filter(
                (event: EventItem) =>
                  !current.events.some((existing) => existing.id === event.id),
              ),
            ],
            nextCursor: result.data.nextCursor,
          },
      );
    } catch (e) {
      setMoreError(
        e instanceof Error ? e.message : "Не удалось загрузить события.",
      );
    } finally {
      setLoadingMore(false);
    }
  }
  useEffect(() => {
    // The effect starts an asynchronous session/API request; updates follow its result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const restore = () => {
      if (document.visibilityState !== "visible") return;
      setPending(true);
      setError("");
      setMoreError("");
      void load();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) restore();
    };
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", show);
    return () => {
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", show);
    };
  }, [load]);
  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      const r = await fetch("/api/auth/csrf", { cache: "no-store" });
      if (r.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!r.ok) throw Error("Не удалось выйти. Повторите попытку.");
      const j = await r.json();
      const out = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": j.data.csrfToken },
      });
      if (!out.ok) throw Error("Не удалось выйти. Повторите попытку.");
      window.location.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выйти.");
      setLoggingOut(false);
    }
  }
  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span aria-hidden="true">♡</span> Family Events
        </div>
        <button className="text-button" onClick={logout} disabled={loggingOut}>
          {loggingOut ? "Выходим…" : "Выйти"}
        </button>
      </header>
      <h1>Мои события</h1>
      <Link href="/events/new" className="primary">
        {data?.resumeDraft ? "Продолжить создание" : "＋ Создать событие"}
      </Link>
      {data && (
        <p className="muted">{data.name}, здесь ваши праздники и встречи.</p>
      )}
      {pending && <p role="status">Загружаем события…</p>}
      {error && (
        <div role="alert" className="card error">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => {
              setPending(true);
              setError("");
              void load();
            }}
          >
            Повторить
          </button>
        </div>
      )}
      {!pending &&
        !error &&
        data &&
        (data.events.length ? (
          <>
            <ul className="event-list">
              {data.events.map((e) => (
                <li className="card" key={e.id}>
                  <Link href={`/events/${e.id}`} className="event-card-link">
                    {e.coverUrl && (
                      <div className="event-cover list-cover">
                        <Image
                          unoptimized
                          width={800}
                          height={480}
                          src={e.coverUrl}
                          alt={`Обложка события «${e.title}»`}
                        />
                      </div>
                    )}
                    <h2>{e.title}</h2>
                    <p>
                      {new Intl.DateTimeFormat("ru-RU", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(e.eventDate + "T12:00:00Z"))}
                      {e.startTime ? " · " + e.startTime.slice(0, 5) : ""}
                    </p>
                    {e.startTime && (
                      <p className="small muted">Часовой пояс: {e.timezone}</p>
                    )}
                    {e.venueName && <p className="muted">{e.venueName}</p>}
                  </Link>
                </li>
              ))}
            </ul>
            {moreError && (
              <p role="alert" className="error">
                {moreError}
              </p>
            )}
            {data.nextCursor && (
              <button
                className="secondary"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore
                  ? "Загружаем…"
                  : moreError
                    ? "Повторить загрузку"
                    : "Показать ещё"}
              </button>
            )}
          </>
        ) : (
          <section className="card empty">
            <h2>У вас пока нет событий</h2>
            <p className="muted">
              Здесь появятся ваши семейные праздники и встречи.
            </p>
            <Link href="/events/new" className="secondary">
              Создать первое событие
            </Link>
          </section>
        ))}
      {data && !pending && (
        <button
          className="secondary refresh"
          disabled={loadingMore}
          onClick={() => {
            setPending(true);
            setError("");
            setMoreError("");
            void load();
          }}
        >
          Обновить список
        </button>
      )}
      <InstallHelp />
    </main>
  );
}
