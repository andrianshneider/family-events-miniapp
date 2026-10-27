"use client";
import Link from "next/link";
import { useState } from "react";
import { organizerMutation } from "@/lib/wishlist-client";
export function EventChangeScreen({
  eventId,
  changeId,
  title,
  decision,
  changes,
}: {
  eventId: string;
  changeId: string;
  title: string;
  decision: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(decision === "pending" ? "" : decision);
  const [attempt, setAttempt] = useState<{
    key: string;
    decision: "send" | "skip";
  } | null>(null);
  async function save(value: "send" | "skip") {
    if (busy) return;
    const op = attempt ?? { key: crypto.randomUUID(), decision: value };
    setAttempt(op);
    setBusy(true);
    setError("");
    try {
      await organizerMutation(
        `/api/v1/events/${eventId}/changes/${changeId}/decision`,
        "POST",
        { decision: op.decision },
        op.key,
      );
      setDone(op.decision);
      setAttempt(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось сохранить решение. Повторите попытку.",
      );
    } finally {
      setBusy(false);
    }
  }
  const names: Record<string, string> = {
    eventDate: "Дата",
    startTime: "Начало",
    endTime: "Окончание",
    timezone: "Часовой пояс",
    venueName: "Место",
    address: "Адрес",
  };
  function display(key: string, value: unknown) {
    if (!value) return "Не указано";
    if (key === "eventDate" && /^\d{4}-\d{2}-\d{2}$/.test(String(value)))
      return new Intl.DateTimeFormat("ru", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(String(value) + "T12:00:00Z"));
    if (key.endsWith("Time")) return String(value).slice(0, 5);
    if (key === "timezone") {
      try {
        const name = new Intl.DateTimeFormat("ru", {
          timeZone: String(value),
          timeZoneName: "longGeneric",
        })
          .formatToParts(new Date())
          .find((part) => part.type === "timeZoneName")?.value;
        return `${name || String(value)} (${String(value)})`;
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
  return (
    <main className="shell event-shell">
      <header className="top">
        <div className="brand">
          <span aria-hidden="true">♡</span>Family Events
        </div>
      </header>
      <Link className="text-button back" href={`/events/${eventId}`}>
        ← К событию
      </Link>
      <h1>Изменения сохранены</h1>
      <p>{title}</p>
      <section className="panel" aria-busy={busy}>
        <h2>Отправить уведомление гостям?</h2>
        {Object.entries(changes).map(([k, v]) => (
          <p key={k}>
            <strong>{names[k] ?? k}</strong>
            <br />
            Было: {display(k, v.before)}
            <br />
            Стало: {display(k, v.after)}
          </p>
        ))}
        {error && <p role="alert">{error}</p>}
        {done ? (
          <p role="status">
            {done === "send"
              ? "Уведомления поставлены в очередь."
              : "Сохранено без рассылки."}
          </p>
        ) : (
          <>
            <p>Подписанные гости получат одно сообщение обо всех изменениях.</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save("send")}
            >
              {busy
                ? "Сохраняем решение…"
                : attempt
                  ? "Проверить результат"
                  : "Отправить уведомление"}
            </button>
            {!attempt && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void save("skip")}
              >
                Не отправлять
              </button>
            )}
          </>
        )}
      </section>
      {done && (
        <Link className="primary route-link" href={`/events/${eventId}`}>
          К событию
        </Link>
      )}
    </main>
  );
}
