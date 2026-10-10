import "server-only";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { eventInput } from "@/lib/validation";
import type { OrganizerPrincipal } from "@/types/principal";
import { db, transaction } from "../db/client";
import { idempotent } from "../db/idempotency";
import { AppError, unavailable } from "../errors";
import { eventTimes } from "./time";
export async function createEvent(
  principal: OrganizerPrincipal,
  data: z.infer<typeof eventInput>,
  key: string,
) {
  return transaction((tx) =>
    idempotent(
      tx,
      "organizer:" + principal.userId,
      "POST /events",
      key,
      data,
      async () => {
        const times = eventTimes(
          data.eventDate,
          data.startTime,
          data.endTime,
          data.timezone,
          true,
        );
        if (data.coverAssetId) {
          const [asset] =
            await tx`SELECT id FROM app.media_assets WHERE id=${data.coverAssetId} AND owner_user_id=${principal.userId} AND state='ready' FOR SHARE`;
          if (!asset)
            throw new AppError(
              422,
              "INVALID_COVER",
              "Выберите завершённую загрузку своей обложки.",
              { coverAssetId: ["Обложка недоступна."] },
            );
        }
        const [event] =
          await tx`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,start_time,end_time,timezone,starts_at,ends_at,effective_at,venue_name,address,directions,description,dress_code,latitude,longitude,cover_asset_id) VALUES(${principal.userId},${randomBytes(16).toString("base64url")},${data.title},${data.eventType},${data.eventDate},${data.startTime ?? null},${data.endTime ?? null},${data.timezone},${times.startsAt},${times.endsAt},${times.effectiveAt},${data.venueName ?? null},${data.address ?? null},${data.directions ?? null},${data.description ?? null},${data.dressCode ?? null},${data.latitude ?? null},${data.longitude ?? null},${data.coverAssetId ?? null}) RETURNING id,public_id,version`;
        await tx`INSERT INTO app.wishlists(event_id) VALUES(${event.id})`;
        await tx`INSERT INTO app.analytics_events(name,event_id,user_id,occurred_at) VALUES('event_created',${event.id},${principal.userId},now())`;
        return {
          status: 201,
          body: {
            id: event.id as string,
            publicId: event.public_id as string,
            version: event.version as number,
          },
        };
      },
    ),
  );
}
export async function organizerEvent(
  principal: OrganizerPrincipal,
  eventId: string,
) {
  const [row] =
    await db()`SELECT e.id,e.title,e.event_type,e.event_date::text,e.start_time::text,e.end_time::text,e.timezone,e.effective_at,e.venue_name,e.address,e.directions,e.description,e.dress_code,e.cover_asset_id,e.version,u.display_name,w.id AS wishlist_id,w.hide_reserver_identity,
    (SELECT count(*)::int FROM app.rsvps r WHERE r.event_id=e.id AND r.status='yes') AS yes,
    (SELECT count(*)::int FROM app.rsvps r WHERE r.event_id=e.id AND r.status='no') AS no,
    (SELECT count(*)::int FROM app.rsvps r WHERE r.event_id=e.id AND r.status='maybe') AS maybe,
    (SELECT coalesce(sum(adults_count),0)::int FROM app.rsvps r WHERE r.event_id=e.id AND r.status='yes') AS adults,
    (SELECT coalesce(sum(children_count),0)::int FROM app.rsvps r WHERE r.event_id=e.id AND r.status='yes') AS children,
    (SELECT count(*)::int FROM app.gifts g WHERE g.wishlist_id=w.id AND g.deleted_at IS NULL) AS gifts
    FROM app.events e JOIN app.users u ON u.id=e.organizer_id LEFT JOIN app.wishlists w ON w.event_id=e.id WHERE e.id=${eventId} AND e.organizer_id=${principal.userId} AND e.deleted_at IS NULL`;
  if (!row) throw unavailable();
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    title: row.title as string,
    eventType: row.event_type as string,
    eventDate: row.event_date as string,
    startTime: row.start_time?.slice(0, 5) ?? null,
    endTime: row.end_time?.slice(0, 5) ?? null,
    timezone: row.timezone as string,
    isPast: new Date(row.effective_at).getTime() < Date.now(),
    venueName: row.venue_name as string | null,
    address: row.address as string | null,
    directions: row.directions as string | null,
    description: row.description as string | null,
    dressCode: row.dress_code as string | null,
    version: row.version as number,
    coverUrl: row.cover_asset_id ? `/api/v1/events/${row.id}/cover` : null,
    wishlist: {
      id: row.wishlist_id as string | null,
      surprise: row.hide_reserver_identity as boolean,
      gifts: row.gifts as number,
    },
    responses: {
      yes: row.yes as number,
      no: row.no as number,
      maybe: row.maybe as number,
      adults: row.adults as number,
      children: row.children as number,
    },
  };
}
