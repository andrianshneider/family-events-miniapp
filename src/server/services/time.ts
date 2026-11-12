import "server-only";
import { Temporal } from "@js-temporal/polyfill";
import { AppError } from "../errors";
export function localInstant(date: string, time: string, timezone: string) {
  try {
    return Temporal.PlainDateTime.from(`${date}T${time}`)
      .toZonedDateTime(timezone, { disambiguation: "reject" })
      .toInstant()
      .toString();
  } catch {
    throw new AppError(
      422,
      "INVALID_LOCAL_TIME",
      "Уточните время: оно неоднозначно или не существует в выбранном часовом поясе.",
    );
  }
}
export function eventTimes(
  date: string,
  start: string | null | undefined,
  end: string | null | undefined,
  timezone: string,
  creating = false,
  now = Temporal.Now.instant(),
) {
  if (
    creating &&
    Temporal.PlainDate.compare(
      Temporal.PlainDate.from(date),
      now.toZonedDateTimeISO(timezone).toPlainDate(),
    ) < 0
  )
    throw new AppError(422, "EVENT_DATE_IN_PAST", "Дата события уже прошла.", {
      eventDate: [
        "Выберите сегодняшнюю или будущую дату в часовом поясе события.",
      ],
    });
  const at = (time: string, field: string) => {
    try {
      return localInstant(date, time, timezone);
    } catch (error) {
      if (error instanceof AppError)
        error.fieldErrors = { [field]: [error.message] };
      throw error;
    }
  };
  const effectiveAt = at(start ?? "00:00", start ? "startTime" : "eventDate");
  return {
    startsAt: start ? effectiveAt : null,
    endsAt: end ? at(end, "endTime") : null,
    effectiveAt,
  };
}
export function reminderAt(
  date: string,
  start: string | null,
  timezone: string,
  now = Temporal.Now.instant(),
) {
  const instant = start
    ? Temporal.Instant.from(localInstant(date, start, timezone)).subtract({
        hours: 24,
      })
    : Temporal.Instant.from(
        localInstant(
          Temporal.PlainDate.from(date).subtract({ days: 1 }).toString(),
          "09:00",
          timezone,
        ),
      );
  return Temporal.Instant.compare(instant, now) > 0 ? instant.toString() : null;
}
