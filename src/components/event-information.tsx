import Image from "next/image";
import type { PublicEvent } from "@/lib/invitation";
import { eventWhen } from "@/lib/invitation";
import { eventTypes } from "./event-presentation";
export function EventInformation({ event }: { event: PublicEvent }) {
  return (
    <article aria-label="Информация о встрече">
      <div className="event-cover public-cover">
        {event.coverUrl ? (
          <Image
            unoptimized
            width={1200}
            height={720}
            src={event.coverUrl}
            alt={`Обложка события «${event.title}»`}
          />
        ) : (
          <span aria-hidden="true">♡</span>
        )}
      </div>
      {event.isPast && <p className="event-status">Событие завершилось</p>}
      <h1>{event.title}</h1>
      <p className="muted">
        {eventTypes[event.eventType as keyof typeof eventTypes]}
      </p>
      <p className="public-date">{eventWhen(event)}</p>
      <p className="timezone">Часовой пояс: {event.timezone}</p>
      {event.venueName && <h2 className="public-venue">{event.venueName}</h2>}
      {event.address && (
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
      {[
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
