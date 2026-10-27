"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Guests, RsvpStatus } from "@/lib/rsvp";
import { watchEventChanges } from "@/lib/event-updates";
import { GuestSummary } from "./guest-summary";
import { GuestCard } from "./guest-card";
import { TelegramBack } from "./telegram-back";
import { eventDateLabel } from "./event-presentation";
export function GuestListScreen({ initial }: { initial: Guests }) {
  const router = useRouter();
  const [data, setData] = useState<Guests | null>(initial),
    [filter, setFilter] = useState(initial.filter),
    [pending, setPending] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState(""),
    [moreError, setMoreError] = useState(""),
    [offline, setOffline] = useState(false),
    [unavailable, setUnavailable] = useState(false);
  const dataRef = useRef<Guests | null>(initial);
  const [notice, setNotice] = useState("");
  const selection = useRef(initial.filter),
    flight = useRef(false),
    generation = useRef(0),
    requested = useRef(false),
    next = useRef<string | null>(initial.nextCursor);
  const api = `/api/v1/events/${initial.event.id}/guests`;
  const load = useCallback(async () => {
    if (flight.current) {
      requested.current = true;
      return;
    }
    flight.current = true;
    setPending(true);
    const active = selection.current,
      stamp = generation.current;
    try {
      const response = await fetch(api + (active ? "?status=" + active : ""), {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401) {
        generation.current++;
        dataRef.current = null;
        next.current = null;
        requested.current = false;
        setData(null);
        window.location.replace(
          "/login?returnTo=" +
            encodeURIComponent(
              `/events/${initial.event.id}/guests${active ? "?status=" + active : ""}`,
            ),
        );
        return;
      }
      if (response.status === 404) {
        generation.current++;
        dataRef.current = null;
        next.current = null;
        requested.current = false;
        setData(null);
        setUnavailable(true);
        return;
      }
      if (!response.ok)
        throw Error(
          "Не удалось обновить ответы. Ранее загруженные данные сохранены.",
        );
      const result: Guests = (await response.json()).data;
      if (stamp !== generation.current) return;
      const old = dataRef.current;
      if (old && old.filter === active && old.revision === result.revision) {
        const kept = {
          ...result,
          guests: old.guests,
          nextCursor: old.nextCursor,
        };
        dataRef.current = kept;
        setData(kept);
        next.current = kept.nextCursor;
      } else {
        if (old && old.filter === active && old.revision !== result.revision) {
          generation.current++;
          setNotice("Ответы изменились. Список обновлён с первой страницы.");
        }
        dataRef.current = result;
        setData(result);
        next.current = result.nextCursor;
      }
      setError("");
      setMoreError("");
    } catch (caught) {
      if (stamp === generation.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Не удалось загрузить список.",
        );
    } finally {
      flight.current = false;
      setPending(false);
      if (requested.current) {
        requested.current = false;
        queueMicrotask(() => void load());
      }
    }
  }, [api, initial.event.id]);
  useEffect(() => {
    const network = () => setOffline(!navigator.onLine);
    network();
    const restore = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void load();
    };
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) restore();
    };
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", show);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("online", restore);
    const interval = window.setInterval(restore, 5000),
      stop = watchEventChanges(restore);
    return () => {
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("online", restore);
      window.clearInterval(interval);
      stop();
    };
  }, [load]);
  function choose(status: RsvpStatus | null) {
    if (status === selection.current) return;
    selection.current = status;
    setFilter(status);
    generation.current++;
    next.current = null;
    const path = `/events/${initial.event.id}/guests${status ? "?status=" + status : ""}`;
    window.history.replaceState(null, "", path);
    if (!navigator.onLine) return;
    void load();
  }
  async function more() {
    if (loadingMore || pending || !next.current || offline) return;
    const cursor = next.current,
      stamp = generation.current,
      active = selection.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const url = new URL(api, window.location.origin);
      url.searchParams.set("cursor", cursor);
      if (active) url.searchParams.set("status", active);
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401) {
        generation.current++;
        dataRef.current = null;
        next.current = null;
        requested.current = false;
        setData(null);
        window.location.replace("/login");
        return;
      }
      if (response.status === 404) {
        generation.current++;
        dataRef.current = null;
        next.current = null;
        requested.current = false;
        setData(null);
        setUnavailable(true);
        return;
      }
      if (!response.ok)
        throw Error(
          "Не удалось загрузить остальные ответы. Повторите попытку.",
        );
      const result: Guests = (await response.json()).data;
      if (stamp !== generation.current) return;
      if (dataRef.current && result.revision !== dataRef.current.revision) {
        generation.current++;
        setNotice("Ответы изменились. Перезагружаем список.");
        await load();
        return;
      }
      setData(
        (current) =>
          current && {
            ...result,
            guests: [
              ...current.guests,
              ...result.guests.filter(
                (guest) => !current.guests.some((old) => old.id === guest.id),
              ),
            ],
          },
      );
      if (dataRef.current)
        dataRef.current = {
          ...result,
          guests: [
            ...dataRef.current.guests,
            ...result.guests.filter(
              (guest) =>
                !dataRef.current!.guests.some((old) => old.id === guest.id),
            ),
          ],
        };
      next.current = result.nextCursor;
    } catch (caught) {
      if (stamp === generation.current)
        setMoreError(
          caught instanceof Error
            ? caught.message
            : "Не удалось загрузить ответы.",
        );
    } finally {
      setLoadingMore(false);
    }
  }
  const shown =
    data?.guests.filter((guest) => !filter || guest.status === filter) ?? [];
  return (
    <main className="shell event-shell guests-shell">
      <TelegramBack onBack={() => router.push(`/events/${initial.event.id}`)} />
      <header className="top">
        <div className="brand">
          <span aria-hidden="true">♡</span>Family Events
        </div>
      </header>
      <Link className="text-button back" href={`/events/${initial.event.id}`}>
        ← К событию
      </Link>
      {unavailable ? (
        <>
          <h1>Событие недоступно</h1>
          <Link className="secondary route-link" href="/events">
            Мои события
          </Link>
        </>
      ) : !data ? (
        <p role="status">Восстанавливаем вход…</p>
      ) : (
        <>
          <h1>Список гостей</h1>
          <h2>{data.event.title}</h2>
          <p>{eventDateLabel(data.event.eventDate)}</p>
          <p className="hint">
            Ответы доступны только организатору этого события.
          </p>
          <GuestSummary summary={data.summary} />
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {offline && (
            <p className="notice" role="status">
              Нет соединения. Показаны ранее загруженные ответы; данные могут
              быть неактуальны.
            </p>
          )}
          {error && (
            <div className="notice error" role="alert">
              <p>{error}</p>
              <button
                className="secondary"
                disabled={pending || offline}
                onClick={load}
              >
                Попробовать снова
              </button>
            </div>
          )}
          <div className="guest-filters" aria-label="Фильтр ответов">
            {[
              [null, "Все"],
              ["yes", "Будут"],
              ["maybe", "Думают"],
              ["no", "Не будут"],
            ].map(([status, label]) => (
              <button
                className="secondary"
                key={status ?? "all"}
                aria-pressed={filter === status}
                onClick={() => choose(status as RsvpStatus | null)}
              >
                {label}
                <span>
                  {status
                    ? data.summary.responses[status as RsvpStatus]
                    : data.summary.responses.total}
                </span>
              </button>
            ))}
          </div>
          <p role="status">
            {pending
              ? "Обновляем ответы…"
              : `Показано ответов: ${shown.length}`}
          </p>
          <div className="guest-cards" aria-busy={pending}>
            {shown.length ? (
              shown.map((guest) => <GuestCard key={guest.id} guest={guest} />)
            ) : data.filter !== filter ? (
              <p role="status">
                {offline
                  ? "Для этого фильтра ещё нет загруженных данных. Подключитесь к сети."
                  : error
                    ? "Ответы этого фильтра пока не загружены. Повторите попытку."
                    : "Загружаем ответы выбранного фильтра…"}
              </p>
            ) : (
              <section className="panel">
                <h2>
                  {data.summary.responses.total
                    ? "В этом фильтре пока нет ответов"
                    : "Пока никто не ответил на приглашение"}
                </h2>
                {data.summary.responses.total ? (
                  <button className="secondary" onClick={() => choose(null)}>
                    Показать всех
                  </button>
                ) : (
                  <Link
                    href={`/events/${initial.event.id}/share`}
                    className="secondary route-link"
                  >
                    К приглашению гостей
                  </Link>
                )}
              </section>
            )}
          </div>
          {moreError && (
            <p className="error" role="alert">
              {moreError}
            </p>
          )}
          {data.nextCursor && !offline && data.filter === filter && (
            <button
              className="secondary"
              disabled={pending || loadingMore}
              onClick={more}
            >
              {loadingMore
                ? "Загружаем…"
                : moreError
                  ? "Повторить загрузку"
                  : "Показать ещё"}
            </button>
          )}
        </>
      )}
    </main>
  );
}
