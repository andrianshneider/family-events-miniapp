import { endpoint, reply } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
import { z } from "zod";
import { AppError } from "@/server/errors";
const cursorSchema = z.object({ date: z.iso.date(), id: z.uuid() }).strict();
export const GET = endpoint(async (request, id) => {
  const principal = await organizer();
  const rawCursor = new URL(request.url).searchParams.get("cursor");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (rawCursor !== null) {
    try {
      if (rawCursor.length > 256 || !/^[\w-]+$/.test(rawCursor)) throw Error();
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new AppError(422, "INVALID_CURSOR", "Обновите список событий.");
    }
  }
  const events = cursor
    ? await db()`SELECT id,title,event_type,event_date::text,start_time::text,timezone,venue_name FROM app.events WHERE organizer_id=${principal.userId} AND deleted_at IS NULL AND (event_date,id)<(${cursor.date}::date,${cursor.id}::uuid) ORDER BY event_date DESC,id DESC LIMIT 101`
    : await db()`SELECT id,title,event_type,event_date::text,start_time::text,timezone,venue_name FROM app.events WHERE organizer_id=${principal.userId} AND deleted_at IS NULL ORDER BY event_date DESC,id DESC LIMIT 101`;
  const last = events[99];
  return reply(
    {
      events: events.slice(0, 100).map((e) => ({
        id: e.id,
        title: e.title,
        eventType: e.event_type,
        eventDate: e.event_date,
        startTime: e.start_time,
        timezone: e.timezone,
        venueName: e.venue_name,
      })),
      hasMore: events.length > 100,
      nextCursor:
        events.length > 100
          ? Buffer.from(
              JSON.stringify({ date: last.event_date, id: last.id }),
            ).toString("base64url")
          : null,
    },
    id,
  );
});
