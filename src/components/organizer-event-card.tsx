"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type Ref } from "react";
import { eventTypes } from "./event-presentation";
import type { EventList } from "@/server/services/event-list";
function Icon({
  kind,
}: {
  kind: "date" | "place" | "gift" | "guests" | "details";
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {kind === "date" ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M7 3v4m10-4v4M3 11h18" />
        </>
      ) : kind === "place" ? (
        <>
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </>
      ) : kind === "gift" ? (
        <>
          <rect x="3" y="9" width="18" height="12" rx="2" />
          <path d="M2 5h20v4H2zM12 5v16M12 5C7-3 1 4 12 5c11-1 5-8 0 0" />
        </>
      ) : kind === "guests" ? (
        <>
          <circle cx="9" cy="7" r="4" />
          <path d="M2 21v-3a7 7 0 0 1 14 0v3m1-18a4 4 0 0 1 0 8m3 10v-3a7 7 0 0 0-2-5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6m0-10h.01" />
        </>
      )}
    </svg>
  );
}
export function OrganizerEventCard({
  event: e,
  detail,
  headingRef,
}: {
  event: EventList["events"][number];
  headingRef?: Ref<HTMLHeadingElement>;
  detail?: {
    refresh: () => void;
    pending: boolean;
  };
}) {
  const [badge, setBadge] = useState("");
  useEffect(() => {
    function update() {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: e.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const days = Math.round(
        (Date.parse(e.eventDate + "T12:00:00Z") -
          Date.parse(today + "T12:00:00Z")) /
          86400000,
      );
      setBadge(
        days === 0
          ? "Сегодня"
          : days === 1
            ? "Завтра"
            : days > 1
              ? `Через ${days} ${new Intl.PluralRules("ru").select(days) === "one" ? "день" : new Intl.PluralRules("ru").select(days) === "few" ? "дня" : "дней"}`
              : "Прошло",
      );
    }
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [e.eventDate, e.timezone]);
  const summary = (
    <>
      {e.coverUrl && (
        <div className="organizer-card-cover">
          <Image
            unoptimized
            width={300}
            height={400}
            src={e.coverUrl}
            alt={`Обложка события «${e.title}»`}
          />
          {badge && <span className="organizer-card-badge">{badge}</span>}
        </div>
      )}
      <div className="organizer-card-copy">
        {!e.coverUrl && badge && <p className="event-status">{badge}</p>}
        {detail ? (
          <h1 ref={headingRef} tabIndex={-1}>
            {e.title}
          </h1>
        ) : (
          <h2>{e.title}</h2>
        )}
        {detail && (
          <p className="organizer-card-type">
            {eventTypes[e.eventType as keyof typeof eventTypes]}
          </p>
        )}
        <p className="organizer-card-row">
          <Icon kind="date" />
          <span>
            {new Intl.DateTimeFormat("ru-RU", {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(e.eventDate + "T12:00:00Z"))}
            {e.startTime
              ? ` · ${e.startTime.slice(0, 5)}${e.endTime ? "–" + e.endTime.slice(0, 5) : ""}`
              : ""}
          </span>
        </p>
        {e.venueName && (
          <p className="organizer-card-row">
            <Icon kind="place" />
            <span>{e.venueName}</span>
          </p>
        )}
        {detail && e.startTime && (
          <p className="organizer-card-zone">Часовой пояс: {e.timezone}</p>
        )}
        <span className="organizer-card-stats">
          {e.responseCount
            ? `Ответов гостей: ${e.responseCount}`
            : "Ответов гостей пока нет"}
        </span>
      </div>
    </>
  );
  const summaryClass = `organizer-card-summary${e.coverUrl ? " with-cover" : ""}`;
  return (
    <article className="organizer-card">
      {detail ? (
        <div className={summaryClass}>{summary}</div>
      ) : (
        <Link href={`/events/${e.id}`} className={summaryClass}>
          {summary}
        </Link>
      )}
      {!detail && (
        <nav
          className="organizer-card-actions"
          aria-label={`Действия: ${e.title}`}
        >
          <Link href={`/events/${e.id}/wishlist?from=events`}>
            <Icon kind="gift" />
            Подарки
          </Link>
          <Link href={`/events/${e.id}/guests`}>
            <Icon kind="guests" />
            Гости
          </Link>
          <Link href={`/events/${e.id}`}>
            <Icon kind="details" />
            Детали
          </Link>
        </nav>
      )}
    </article>
  );
}
