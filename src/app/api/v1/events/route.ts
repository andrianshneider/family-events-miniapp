import { endpoint, reply } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
export const GET = endpoint(async (_request, id) => {
  const principal = await organizer();
  const events =
    await db()`SELECT id,title,event_type,event_date::text,start_time::text,timezone,venue_name FROM app.events WHERE organizer_id=${principal.userId} AND deleted_at IS NULL ORDER BY event_date DESC,created_at DESC LIMIT 101`;
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
    },
    id,
  );
});
