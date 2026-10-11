import "server-only";
import type { PublicEvent } from "@/lib/invitation";
import { mapsUrl } from "@/lib/invitation";
import type { OrganizerPrincipal } from "@/types/principal";
import { db } from "../db/client";
import { unavailable } from "../errors";
import { setting } from "../config";
export function validPublicId(value: string) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) throw unavailable();
  return value;
}
export function canonicalEventUrl(publicId: string) {
  validPublicId(publicId);
  const origin = new URL(setting("APP_URL"));
  if (
    origin.username ||
    origin.password ||
    !["https:", "http:"].includes(origin.protocol) ||
    (process.env.APP_ENV !== "local" && origin.protocol !== "https:")
  )
    throw Error("Invalid application origin");
  return new URL(`/e/${publicId}`, origin.origin).toString();
}
export async function publicEvent(publicId: string): Promise<PublicEvent> {
  validPublicId(publicId);
  // Explicit public projection: no users, identities, RSVP, reservations or private DTO.
  const [row] =
    await db()`SELECT e.public_id,e.title,e.event_type,e.event_date::text,e.start_time::text,e.end_time::text,e.timezone,e.effective_at,e.venue_name,e.address,e.directions,e.description,e.dress_code,e.latitude,e.longitude,e.version,
    CASE WHEN m.state='ready' THEN true ELSE false END AS has_cover
    FROM app.events e LEFT JOIN app.media_assets m ON m.id=e.cover_asset_id AND m.owner_user_id=e.organizer_id
    WHERE e.public_id=${publicId} AND e.deleted_at IS NULL`;
  if (!row) throw unavailable();
  const text = (value: string | null) => value?.trim() || null;
  const address = text(row.address);
  return {
    publicId: row.public_id as string,
    title: row.title as string,
    eventType: row.event_type as string,
    eventDate: row.event_date as string,
    startTime: row.start_time?.slice(0, 5) ?? null,
    endTime: row.end_time?.slice(0, 5) ?? null,
    timezone: row.timezone as string,
    isPast: new Date(row.effective_at).getTime() < Date.now(),
    venueName: text(row.venue_name),
    address,
    directions: text(row.directions),
    description: text(row.description),
    dressCode: text(row.dress_code),
    version: row.version as number,
    coverUrl: row.has_cover
      ? `/api/v1/public/events/${publicId}/cover?v=${row.version}`
      : null,
    routeUrl: mapsUrl(
      address,
      row.latitude == null ? null : Number(row.latitude),
      row.longitude == null ? null : Number(row.longitude),
    ),
  };
}
export async function invitation(
  principal: OrganizerPrincipal,
  eventId: string,
) {
  const [row] =
    await db()`SELECT public_id FROM app.events WHERE id=${eventId} AND organizer_id=${principal.userId} AND deleted_at IS NULL`;
  if (!row) throw unavailable();
  return {
    event: await publicEvent(row.public_id),
    publicUrl: canonicalEventUrl(row.public_id),
  };
}
