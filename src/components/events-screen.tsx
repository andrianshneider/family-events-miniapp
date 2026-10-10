"use client";
import { useCallback, useEffect, useState } from "react";
type EventItem = {
  id: string;
  title: string;
  eventDate: string;
  startTime: string | null;
  timezone: string;
  venueName: string | null;
};
type Loaded = { name: string; events: EventItem[]; hasMore: boolean };
export function EventsScreen() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
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
      setData({
        name: profile.data.displayName,
        events: result.data.events,
        hasMore: result.data.hasMore,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить события.",
      );
    } finally {
      setPending(false);
    }
  }, []);
  useEffect(() => {
    // The effect starts an asynchronous session/API request; updates follow its result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
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
                </li>
              ))}
            </ul>
            {data.hasMore && (
              <p className="muted">Показаны последние 100 событий.</p>
            )}
          </>
        ) : (
          <section className="card empty">
            <h2>У вас пока нет событий</h2>
            <p className="muted">
              Здесь появятся ваши семейные праздники и встречи.
            </p>
          </section>
        ))}
      {data && !pending && (
        <button
          className="secondary refresh"
          onClick={() => {
            setPending(true);
            setError("");
            void load();
          }}
        >
          Обновить список
        </button>
      )}
    </main>
  );
}
