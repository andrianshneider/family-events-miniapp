import {success,actorRelation,optional} from "../analytics/journal";
import {transferOrigin} from "../analytics/context";
import "server-only";
import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import type { z } from "zod";
import type { GuestContext, Rsvp, Summary } from "@/lib/rsvp";
import { rsvpInput } from "@/lib/validation";
import type { GuestPrincipal } from "@/types/principal";
import { db, transaction } from "../db/client";
import { guest, GUEST_COOKIE } from "../auth/sessions";
import { setting } from "../config";
import { AppError, unavailable, unauthenticated } from "../errors";
import { idempotent } from "../db/idempotency";
import { validPublicId } from "./public-events";
import { organizerRsvpMessage } from "../notifications/templates";
import { planReminders } from "../notifications/guest";
import { enqueue } from "../notifications/outbox";
export function rsvpDto(row: Record<string, unknown>): Rsvp {
  return {
    id: String(row.id),
    guestName: String(row.guest_name),
    status: row.status as Rsvp["status"],
    adultsCount: Number(row.adults_count),
    childrenCount: Number(row.children_count),
    comment: row.comment as string | null,
    version: Number(row.version),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}
export function summaryDto(row: Record<string, unknown>): Summary {
  const yes = Number(row.yes),
    no = Number(row.no),
    maybe = Number(row.maybe);
  return {
    responses: { yes, no, maybe, total: yes + no + maybe },
    confirmed: { adults: Number(row.adults), children: Number(row.children) },
  };
}
export async function guestContext(publicId: string): Promise<GuestContext> {
  validPublicId(publicId);
  const [event] =
    await db()`SELECT id FROM app.events WHERE public_id=${publicId} AND deleted_at IS NULL`;
  if (!event) throw unavailable();
  let principal: GuestPrincipal;
  try {
    principal = await guest();
  } catch (error) {
    if (!(error instanceof AppError && error.status === 401)) throw error;
    return {
      rsvp: null,
      defaultName: null,
      notificationsEnabled: false,
      sessionState: (await cookies()).get(GUEST_COOKIE) ? "lost" : "none",
      contextKey: null,
    };
  }
  const [row] =
    await db()`SELECT r.id,r.guest_name,r.status,r.adults_count,r.children_count,r.comment,r.version,r.updated_at,g.display_name,
    EXISTS(SELECT 1 FROM app.notification_subscriptions WHERE event_id=e.id AND guest_identity_id=${principal.guestIdentityId} AND role='guest' AND enabled AND revoked_at IS NULL) AS enabled
    FROM app.events e LEFT JOIN app.rsvps r ON r.event_id=e.id AND r.guest_identity_id=${principal.guestIdentityId}
    LEFT JOIN app.guest_identities g ON g.id=${principal.guestIdentityId} WHERE e.public_id=${publicId} AND e.deleted_at IS NULL`;
  if (!row) throw unavailable();
  return {
    rsvp: row.id ? rsvpDto(row) : null,
    defaultName: row.display_name ?? null,
    notificationsEnabled: row.enabled,
    sessionState: "active",
    contextKey: createHmac("sha256", setting("SESSION_SECRET"))
      .update("guest-context:" + principal.guestIdentityId)
      .digest("base64url"),
  };
}
export async function saveRsvp(
  principal: GuestPrincipal,
  publicId: string,
  data: z.infer<typeof rsvpInput>,
  key: string,
) {
  validPublicId(publicId);
  const normalized = { ...data, comment: data.comment?.trim() || null };
  return transaction(async (tx) => {
    const [identity] =
      await tx`SELECT g.id FROM app.guest_identities g JOIN app.guest_sessions s ON s.guest_identity_id=g.id WHERE g.id=${principal.guestIdentityId} AND s.id=${principal.sessionId} AND s.revoked_at IS NULL AND s.expires_at>now() AND g.merged_into_id IS NULL FOR UPDATE OF g`;
    if (!identity) throw unauthenticated();
    const [event] =
      await tx`SELECT id,organizer_id,title FROM app.events WHERE public_id=${publicId} AND deleted_at IS NULL FOR UPDATE`;
    if (!event) throw unavailable();
    return idempotent<{ rsvp: Rsvp; changed: boolean }>(
      tx,
      "guest:" + principal.guestIdentityId,
      `PUT /public/events/${publicId}/rsvp`,
      key,
      normalized,
      async () => {
        const [old] =
          await tx`SELECT id,guest_name,status,adults_count,children_count,comment,version,updated_at FROM app.rsvps WHERE event_id=${event.id} AND guest_identity_id=${principal.guestIdentityId} FOR UPDATE`;
        if (
          old
            ? normalized.expectedVersion !== old.version
            : normalized.expectedVersion !== null
        )
          throw new AppError(
            409,
            "RSVP_VERSION_CONFLICT",
            "Ответ изменился. Загрузите текущий ответ перед сохранением.",
          );
        const changed =
          !old ||
          old.guest_name !== normalized.guestName ||
          old.status !== normalized.status ||
          old.adults_count !== normalized.adultsCount ||
          old.children_count !== normalized.childrenCount ||
          (old.comment?.trim() || null) !== normalized.comment;
        if (!changed)
          return { status: 200, body: { rsvp: rsvpDto(old), changed: false } };
        const [saved] = old
          ? await tx`UPDATE app.rsvps SET guest_name=${normalized.guestName},status=${normalized.status},adults_count=${normalized.adultsCount},children_count=${normalized.childrenCount},comment=${normalized.comment},version=version+1 WHERE id=${old.id} RETURNING id,guest_name,status,adults_count,children_count,comment,version,updated_at`
          : await tx`INSERT INTO app.rsvps(event_id,guest_identity_id,guest_name,status,adults_count,children_count,comment) VALUES(${event.id},${principal.guestIdentityId},${normalized.guestName},${normalized.status},${normalized.adultsCount},${normalized.childrenCount},${normalized.comment}) RETURNING id,guest_name,status,adults_count,children_count,comment,version,updated_at`;
        await tx`UPDATE app.guest_identities SET display_name=${normalized.guestName} WHERE id=${principal.guestIdentityId}`;
        if (normalized.status === "no")
          await tx`UPDATE app.notifications SET status='cancelled',locked_until=NULL WHERE type='reminder_24h' AND status IN('pending','processing') AND subscription_id IN(SELECT id FROM app.notification_subscriptions WHERE event_id=${event.id} AND guest_identity_id=${principal.guestIdentityId} AND role='guest')`;
        await planReminders(tx, event.id);
        const subscriptions =
          await tx`SELECT s.id FROM app.notification_subscriptions s JOIN app.telegram_channels c ON c.user_id=s.user_id WHERE s.event_id=${event.id} AND s.user_id=${event.organizer_id} AND s.role='organizer' AND s.enabled AND s.consented_at IS NOT NULL AND s.revoked_at IS NULL AND c.delivery_state='ready' AND c.permission_granted_at IS NOT NULL FOR UPDATE OF s`;
        const message = organizerRsvpMessage(
          String(event.title),
          normalized,
          old,
        );
        for (const subscription of subscriptions)
          await enqueue(
            tx,
            subscription.id,
            old ? "rsvp_changed" : "rsvp_new",
            `rsvp:${saved.id}:v${saved.version}`,
            message,
            new Date().toISOString(),
            {
              label: old ? "Открыть гостей" : "Открыть событие",
              path: `/events/${event.id}${old ? "/guests" : ""}`,
            },
          );
        if(!old)await optional(tx,async save=>{await success(save,"rsvp_submitted",{event_id:event.id,rsvp_id:saved.id,rsvp_version:saved.version,status:normalized.status,actor_relation:await actorRelation(save,event.id,undefined,principal.guestIdentityId)},undefined,principal.guestIdentityId);});
        await optional(tx,save=>transferOrigin(save,undefined,principal.guestIdentityId));
        return { status: 200, body: { rsvp: rsvpDto(saved), changed: true } };
      },
    );
  });
}
