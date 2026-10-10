"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { organizerEvent } from "@/server/services/events";
import { eventDateLabel, eventTypes } from "./event-presentation";
import { TelegramBack } from "./telegram-back";
import { OrganizerHeader } from "./organizer-header";
type Event = Awaited<ReturnType<typeof organizerEvent>>;
export function EventScreen({
  initialEvent,
  created,
}: {
  initialEvent: Event;
  created: boolean;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const [event, setEvent] = useState(initialEvent);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  async function refresh() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/events/${initialEvent.id}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (response.status === 404) {
        setUnavailable(true);
        return;
      }
      if (!response.ok) throw Error();
      setEvent((await response.json()).data);
    } catch {
      setError(
        "Не удалось обновить событие. Сохранённые сведения остаются на экране; повторите попытку.",
      );
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    const restore = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) void refresh();
    };
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", show);
    return () => {
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", show);
    };
    // Only the stable event ID identifies this subscription; server rechecks ownership on each request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEvent.id]);
  if (unavailable)
    return (
      <main className="shell">
        <h1>Событие недоступно</h1>
        <p>Оно удалено или у вас нет доступа.</p>
        <Link href="/events" className="secondary">
          Мои события
        </Link>
      </main>
    );
  return (
    <main className="shell event-shell">
      <TelegramBack onBack={() => router.push("/events")} />
      <OrganizerHeader displayName={event.displayName} />
      <Link className="text-button back" href="/events">
        ← Мои события
      </Link>
      {created && (
        <p className="notice success" role="status">
          Событие создано
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="text-button" onClick={refresh} disabled={pending}>
            Попробовать снова
          </button>
        </div>
      )}
      <div className="event-layout event-detail" aria-busy={pending}>
        <section className="panel">
          {event.coverUrl && (
            <div className="event-cover detail-cover">
              <Image
                unoptimized
                width={1000}
                height={600}
                src={event.coverUrl}
                alt={`Обложка события «${event.title}»`}
              />
            </div>
          )}
          <p className="event-status">
            {event.isPast ? "Прошедшее событие" : "Предстоящее событие"}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {event.title}
          </h1>
          <p className="muted">
            {eventTypes[event.eventType as keyof typeof eventTypes]}
          </p>
          <p>
            {eventDateLabel(event.eventDate)}
            {event.startTime
              ? ` · ${event.startTime}${event.endTime ? "–" + event.endTime : ""}`
              : ""}
          </p>
          <p className="timezone">Часовой пояс: {event.timezone}</p>
          {event.venueName && <h2>{event.venueName}</h2>}
          {[
            ["Адрес", event.address],
            ["Как найти", event.directions],
            ["Описание", event.description],
            ["Дресс-код", event.dressCode],
          ].map(([label, value]) =>
            value ? (
              <section className="event-text" key={label}>
                <h2>{label}</h2>
                <p>{value}</p>
              </section>
            ) : null,
          )}
          <button className="secondary" onClick={refresh} disabled={pending}>
            {pending ? "Обновляем…" : "Обновить сведения"}
          </button>
        </section>
        <aside className="form-panels">
          <section className="panel">
            <h2>Ответы гостей</h2>
            <p className="hint">
              Подтвердили: {event.responses.adults} взрослых ·{" "}
              {event.responses.children} детей
            </p>
            <div className="response-summary">
              <p>
                <strong>{event.responses.yes}</strong>
                <span>Будут</span>
              </p>
              <p>
                <strong>{event.responses.no}</strong>
                <span>Не будут</span>
              </p>
              <p>
                <strong>{event.responses.maybe}</strong>
                <span>Пока не знают</span>
              </p>
            </div>
            <p className="muted">
              {event.responses.yes + event.responses.no + event.responses.maybe
                ? "Ответы сохранены в событии."
                : "Пока никто не ответил на приглашение."}
            </p>
          </section>
          <section className="panel">
            <h2>Вишлист</h2>
            <p>
              {event.wishlist.gifts
                ? `Подарков: ${event.wishlist.gifts}`
                : "Вишлист создан. Подарков пока нет."}
            </p>
            <p className="muted">
              {event.wishlist.surprise
                ? "Режим сюрприза включён."
                : "Режим сюрприза выключен."}
            </p>
            <p className="hint">Добавление подарков скоро появится.</p>
          </section>
          <section className="panel">
            <h2>Пригласите близких</h2>
            <p className="muted">
              Приглашения скоро появятся. Вы сможете поделиться одной ссылкой на
              событие.
            </p>
            <button className="primary" disabled>
              Пригласить гостей
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
