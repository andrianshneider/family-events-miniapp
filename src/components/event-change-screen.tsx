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
  return (
    <main className="shell">
      <Link href={`/events/${eventId}`}>← К событию</Link>
      <h1>Изменения сохранены</h1>
      <p>{title}</p>
      <section className="panel" aria-busy={busy}>
        <h2>Отправить уведомление гостям?</h2>
        {Object.entries(changes).map(([k, v]) => (
          <p key={k}>
            {names[k] ?? k}: {String(v.before ?? "не указано")} →{" "}
            {String(v.after ?? "не указано")}
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
              {attempt ? "Повторить решение" : "Отправить"}
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
    </main>
  );
}
