import "server-only";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { eventInput, eventUpdateInput } from "@/lib/validation";
import type { OrganizerPrincipal } from "@/types/principal";
import { db, transaction } from "../db/client";
import { idempotent } from "../db/idempotency";
import { AppError, unavailable } from "../errors";
import { eventTimes } from "./time";
import { ownedEvent, expectedVersion } from "../db/authorization";
export async function updateEvent(
  principal: OrganizerPrincipal,
  eventId: string,
  input: z.infer<typeof eventUpdateInput>,
  key: string,
) {
  return transaction(async (tx) => {
    const owner = await ownedEvent(tx, principal, eventId);
    return idempotent(
      tx,
      "organizer:" + principal.userId,
      `PATCH /events/${eventId}`,
      key,
      input,
      async () => {
        expectedVersion(owner.version, input.expectedVersion);
        const data = input.fields;
        const times = eventTimes(
          data.eventDate,
          data.startTime,
          data.endTime,
          data.timezone,
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
        const [before] =
          await tx`SELECT event_date::text,start_time::text,end_time::text,timezone,venue_name,address FROM app.events WHERE id=${eventId}`;
        const significant = {
          eventDate: [before.event_date, data.eventDate],
          startTime: [
            before.start_time?.slice(0, 5) ?? null,
            data.startTime ?? null,
          ],
          endTime: [before.end_time?.slice(0, 5) ?? null, data.endTime ?? null],
          timezone: [before.timezone, data.timezone],
          venueName: [
            (before.venue_name ?? "").trim(),
            (data.venueName ?? "").trim(),
          ],
          address: [(before.address ?? "").trim(), (data.address ?? "").trim()],
        };
        const changes = Object.fromEntries(
          Object.entries(significant)
            .filter(([, [a, b]]) => a !== b)
            .map(([field, [before, after]]) => [field, { before, after }]),
        );
        const [event] =
          await tx`UPDATE app.events SET title=${data.title},event_type=${data.eventType},event_date=${data.eventDate},start_time=${data.startTime ?? null},end_time=${data.endTime ?? null},timezone=${data.timezone},starts_at=${times.startsAt},ends_at=${times.endsAt},effective_at=${times.effectiveAt},venue_name=${data.venueName ?? null},address=${data.address ?? null},directions=${data.directions ?? null},description=${data.description ?? null},dress_code=${data.dressCode ?? null},latitude=${data.latitude ?? null},longitude=${data.longitude ?? null},cover_asset_id=${data.coverAssetId ?? null},version=version+1,updated_at=now() WHERE id=${eventId} AND organizer_id=${principal.userId} AND deleted_at IS NULL RETURNING id,version`;
        let changeId: string | null = null;
        const [recipients] =
          await tx`SELECT count(*)::int AS count FROM app.notification_subscriptions WHERE event_id=${eventId} AND role='guest' AND enabled=true AND revoked_at IS NULL`;
        if (Object.keys(changes).length) {
          const [change] =
            await tx`INSERT INTO app.event_changes(event_id,event_version,actor_user_id,changes,notify_decision,decided_at) VALUES(${eventId},${event.version},${principal.userId},${tx.json(changes)},${recipients.count ? "pending" : "skip"},${recipients.count ? null : new Date()}) RETURNING id`;
          changeId = change.id;
          // Do not send notifications on save. Cancel obsolete pending reminders.
          await tx`UPDATE app.notifications SET status='cancelled' WHERE type='reminder_24h' AND status='pending' AND subscription_id IN (SELECT id FROM app.notification_subscriptions WHERE event_id=${eventId})`;
        }
        return {
          status: 200,
          body: {
            id: event.id as string,
            version: event.version as number,
            changeId,
            notificationRecipientsCount: recipients.count as number,
          },
        };
      },
    );
  });
}
// Keep the event lock before the idempotency receipt and all child mutations.
// A confirmed receipt can be retried even after the event becomes unavailable to GET.
export async function deleteEvent(
  principal: OrganizerPrincipal,
  eventId: string,
  input: { expectedVersion: number },
  key: string,
) {
  return transaction(async (tx) => {
    const [event] =
      await tx`SELECT id,version,deleted_at FROM app.events WHERE id=${eventId} AND organizer_id=${principal.userId} FOR UPDATE`;
    if (!event) throw unavailable();
    return idempotent(
      tx,
      "organizer:" + principal.userId,
      `DELETE /events/${eventId}`,
      key,
      input,
      async () => {
        // Own repeated deletion is a confirmed success, including with a fresh key.
        // No version increment or child side effects happen again.
        if (!event.deleted_at) {
          expectedVersion(event.version, input.expectedVersion);
          await tx`SELECT app.soft_delete_event(${eventId},${principal.userId},${input.expectedVersion})`;
        }
        const [deleted] =
          await tx`SELECT id,version,deleted_at FROM app.events WHERE id=${eventId}`;
        return {
          status: 200,
          body: {
            id: deleted.id as string,
            version: deleted.version as number,
            deleted: true,
          },
        };
      },
    );
  });
}
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
    await db()`SELECT e.id,e.title,e.event_type,e.event_date::text,e.start_time::text,e.end_time::text,e.timezone,e.effective_at,e.venue_name,e.address,e.directions,e.description,e.dress_code,e.latitude,e.longitude,e.cover_asset_id,e.version,u.display_name,w.id AS wishlist_id,w.hide_reserver_identity,
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
    coverAssetId: row.cover_asset_id as string | null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
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
