"use client";
import {resetClientAnalytics} from "@/lib/analytics/client";
import { watchEventChanges } from "@/lib/event-updates";
import { InstallHelp } from "./install-help";
import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import type { EventList } from "@/server/services/event-list";
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
type Initial = EventList & {
  profile: { id: string; displayName: string; avatarUrl: string | null };
};
export function EventsScreen({
  initial,
  deleted = false,
}: {
  initial: Initial;
  deleted?: boolean;
}) {
  const [data, setData] = useState<Loaded>({
    name: initial.profile.displayName,
    events: initial.events,
    nextCursor: initial.nextCursor,
    resumeDraft: false,
  });
  const flight = useRef<Promise<void> | null>(null);
  const lastRefresh = useRef(0);

  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const load = useCallback(() => {
    if (flight.current) return flight.current;
    setPending(true);
    const work = (async () => {
      try {
        const response = await fetch("/api/v1/events", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 401) {
          setData({
            name: "",
            events: [],
            nextCursor: null,
            resumeDraft: false,
          });
          window.location.replace("/login");
          return;
        }
        if (!response.ok)
          throw Error(
            "Не удалось обновить события. Сохранённый список остаётся на экране.",
          );
        const result = await response.json();
        let resumeDraft = false;
        try {
          resumeDraft = !!readEventForm(
            localStorage.getItem("fe-create-event-form-v1"),
            result.data.profile.id,
          );
        } catch {}
        setData({
          name: result.data.profile.displayName,
          events: result.data.events,
          nextCursor: result.data.nextCursor,
          resumeDraft,
        });
        setError("");
        lastRefresh.current = Date.now();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Не удалось обновить события.",
        );
      } finally {
        setPending(false);
        flight.current = null;
      }
    })();
    flight.current = work;
    return work;
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
    // Initial data already arrived in server HTML; read only optional local draft state.
    let draft = false;
    try {
      const raw = localStorage.getItem("fe-create-event-form-v1");
      draft = !!readEventForm(raw, initial.profile.id);
      if (raw && !draft) localStorage.removeItem("fe-create-event-form-v1");
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData((current) => ({ ...current, resumeDraft: draft }));
    const restore = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastRefresh.current < 1000
      )
        return;
      lastRefresh.current = Date.now();
      void load();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) restore();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 90000);
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", show);
    window.addEventListener("online", restore);
    const stopWatching = watchEventChanges(() => {
      if (document.visibilityState !== "visible") return;
      if (flight.current) void flight.current.then(() => load());
      else void load();
    });
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("online", restore);
      stopWatching();
    };
  }, [load, initial.profile.id]);
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
      resetClientAnalytics();
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
      {deleted && (
        <p className="notice success" role="status">
          Событие удалено
        </p>
      )}
      <Link href="/events/new" className="primary">
        {data?.resumeDraft ? "Продолжить создание" : "＋ Создать событие"}
      </Link>
      {data && (
        <p className="muted">{data.name}, здесь ваши праздники и встречи.</p>
      )}
      {pending && <p role="status">Обновляем события…</p>}
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
      {data &&
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
                disabled={loadingMore || pending}
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
      {data && (
        <button
          className="secondary refresh"
          disabled={loadingMore || pending}
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
