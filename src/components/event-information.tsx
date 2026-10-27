import Image from "next/image";
import type { PublicEvent } from "@/lib/invitation";
import { eventWhen } from "@/lib/invitation";
import { eventTypes } from "./event-presentation";
export function EventInformation({
  event,
  part = "all",
  preview = false,
}: {
  event: PublicEvent;
  part?: "all" | "summary" | "address" | "details";
  preview?: boolean;
}) {
  return (
    <article aria-label="Информация о встрече">
      {(part === "all" || part === "summary") && (
        <>
          {event.coverUrl && (
            <div className="event-cover public-cover">
              <Image
                unoptimized
                width={1200}
                height={720}
                src={event.coverUrl}
                alt={`Обложка события «${event.title}»`}
              />
            </div>
          )}
          {event.isPast && <p className="event-status">Событие завершилось</p>}
          {preview ? <h2>{event.title}</h2> : <h1>{event.title}</h1>}
          <p className="muted">
            {eventTypes[event.eventType as keyof typeof eventTypes]}
          </p>
          <p className="public-date">
            {event.eventDate ? eventWhen(event) : "Выберите дату"}
          </p>
          <p className="timezone">Часовой пояс: {event.timezone}</p>
          {event.venueName && (
            <h2 className="public-venue">{event.venueName}</h2>
          )}
        </>
      )}
      {(part === "all" || part === "address") && event.address && (
        <section className="event-text">
          <h2>Адрес</h2>
          <p>{event.address}</p>
          {event.routeUrl && (
            <a
              className="secondary route-link"
              href={event.routeUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Построить маршрут: ${event.address}. Карта откроется в новой вкладке`}
            >
              Построить маршрут ↗
            </a>
          )}
        </section>
      )}
      {(part === "all" || part === "details") &&
        [
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
    </article>
  );
}
