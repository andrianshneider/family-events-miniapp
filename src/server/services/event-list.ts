import "server-only";
import { db } from "../db/client";
import type { OrganizerPrincipal } from "@/types/principal";
import { timed } from "../performance";
import { storage, mediaBucket } from "../storage/client";
import { thumbnailPath } from "../storage/thumbnails";
export async function eventList(
  principal: OrganizerPrincipal,
  cursor?: { date: string; id: string },
) {
  const events = await timed("events_db", async () =>
    cursor
      ? await db()`SELECT e.id,e.title,e.event_type,e.event_date::text,e.start_time::text,e.end_time::text,(SELECT count(*)::int FROM app.rsvps r WHERE r.event_id=e.id) AS response_count,e.timezone,e.venue_name,m.storage_path FROM app.events e LEFT JOIN app.media_assets m ON m.id=e.cover_asset_id AND m.owner_user_id=e.organizer_id AND m.state='ready' WHERE e.organizer_id=${principal.userId} AND e.deleted_at IS NULL AND (e.event_date,e.id)<(${cursor.date}::date,${cursor.id}::uuid) ORDER BY e.event_date DESC,e.id DESC LIMIT 101`
      : await db()`SELECT e.id,e.title,e.event_type,e.event_date::text,e.start_time::text,e.end_time::text,(SELECT count(*)::int FROM app.rsvps r WHERE r.event_id=e.id) AS response_count,e.timezone,e.venue_name,m.storage_path FROM app.events e LEFT JOIN app.media_assets m ON m.id=e.cover_asset_id AND m.owner_user_id=e.organizer_id AND m.state='ready' WHERE e.organizer_id=${principal.userId} AND e.deleted_at IS NULL ORDER BY e.event_date DESC,e.id DESC LIMIT 101`,
  );
  const page = events.slice(0, 100),
    paths = [
      ...new Set(
        page
          .filter((e) => e.storage_path)
          .map((e) => thumbnailPath(e.storage_path)),
      ),
    ];
  const urls = new Map<string, string>();
  if (paths.length)
    await timed("storage_sign", async () => {
      const { data, error } = await storage()
        .from(mediaBucket())
        .createSignedUrls(paths, 120);
      if (!error)
        for (const item of data ?? [])
          if (item.path && item.signedUrl && !item.error)
            urls.set(item.path, item.signedUrl);
    });
  const last = events[99];
  return {
    events: page.map((e) => ({
      id: e.id as string,
      title: e.title as string,
      eventType: e.event_type as string,
      eventDate: e.event_date as string,
      startTime: e.start_time as string | null,
      endTime: e.end_time as string | null,
      responseCount: e.response_count as number,
      timezone: e.timezone as string,
      venueName: e.venue_name as string | null,
      coverUrl: e.storage_path
        ? (urls.get(thumbnailPath(e.storage_path)) ??
          `/api/v1/events/${e.id}/cover`)
        : null,
    })),
    hasMore: events.length > 100,
    nextCursor:
      events.length > 100
        ? Buffer.from(
            JSON.stringify({ date: last.event_date, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
export type EventList = Awaited<ReturnType<typeof eventList>>;
