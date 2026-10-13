import "server-only";
import { reserveInput, cancelInput } from "@/lib/reservation-validation";
import { z } from "zod";
import type { GuestPrincipal } from "@/types/principal";
import type { OwnReservation, ReservationContext } from "@/lib/reservation";
import { transaction } from "../db/client";
import { idempotent } from "../db/idempotency";
import { AppError, unauthenticated, unavailable } from "../errors";
import { validPublicId } from "./public-events";
import { guestContext } from "./rsvps";
import { guest } from "../auth/sessions";
const dto = (r: Record<string, unknown>): OwnReservation => ({
  reservationId: String(r.reservation_id),
  giftId: String(r.gift_id),
  reservedAt: new Date(r.reserved_at as string).toISOString(),
});
export async function myReservations(
  publicId: string,
  cursor: string | null,
): Promise<ReservationContext> {
  validPublicId(publicId);
  if (cursor && !z.uuid().safeParse(cursor).success)
    throw new AppError(422, "INVALID_CURSOR", "Некорректная страница списка.");
  const context = await guestContext(publicId);
  const base = {
    defaultName: context.rsvp?.guestName ?? context.defaultName,
    sessionState: context.sessionState,
    contextKey: context.contextKey,
  };
  if (context.sessionState !== "active")
    return { ...base, reservations: [], nextCursor: null };
  const principal = await guest();
  return transaction(async (tx) => {
    const [e] =
      await tx`SELECT id FROM app.events WHERE public_id=${publicId} AND deleted_at IS NULL FOR SHARE`;
    if (!e) throw unavailable();
    const [live] =
      await tx`SELECT id FROM app.guest_sessions WHERE id=${principal.sessionId} AND guest_identity_id=${principal.guestIdentityId} AND revoked_at IS NULL AND expires_at>now()`;
    if (!live) throw unauthenticated();
    const rows =
      await tx`SELECT r.id AS reservation_id,r.gift_id,r.reserved_at FROM app.gift_reservations r JOIN app.gifts g ON g.id=r.gift_id JOIN app.wishlists w ON w.id=g.wishlist_id WHERE w.event_id=${e.id} AND g.deleted_at IS NULL AND r.status='active' AND r.guest_identity_id=${principal.guestIdentityId} AND (${cursor}::uuid IS NULL OR r.id>${cursor}::uuid) ORDER BY r.id LIMIT 101`;
    return {
      ...base,
      reservations: rows.slice(0, 100).map(dto),
      nextCursor: rows.length > 100 ? String(rows[99].reservation_id) : null,
    };
  });
}
export async function mutateReservation(
  principal: GuestPrincipal,
  publicId: string,
  giftId: string,
  method: "POST" | "DELETE",
  data: z.infer<typeof reserveInput> | z.infer<typeof cancelInput>,
  key: string,
) {
  validPublicId(publicId);
  if (!z.uuid().safeParse(giftId).success) throw unavailable();
  try {
    return await transaction(async (tx) => {
      // Matches RSVP: identity before Event; DB functions then lock Gift.
      const [identity] =
        await tx`SELECT g.id,g.display_name FROM app.guest_identities g JOIN app.guest_sessions s ON s.guest_identity_id=g.id WHERE g.id=${principal.guestIdentityId} AND s.id=${principal.sessionId} AND s.revoked_at IS NULL AND s.expires_at>now() AND g.merged_into_id IS NULL FOR UPDATE OF g`;
      if (!identity) throw unauthenticated();
      const [liveSession] =
        await tx`SELECT id FROM app.guest_sessions WHERE id=${principal.sessionId} AND guest_identity_id=${principal.guestIdentityId} AND revoked_at IS NULL AND expires_at>now() FOR SHARE`;
      if (!liveSession) throw unauthenticated();
      const [event] =
        await tx`SELECT id FROM app.events WHERE public_id=${publicId} AND deleted_at IS NULL FOR UPDATE`;
      if (!event) throw unavailable();
      const [gift] =
        await tx`SELECT g.id FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id WHERE g.id=${giftId} AND w.event_id=${event.id} AND g.deleted_at IS NULL FOR UPDATE OF g`;
      if (!gift)
        throw new AppError(
          404,
          "GIFT_UNAVAILABLE",
          "Подарок больше недоступен.",
        );
      return idempotent<
        | { cancelled: boolean; reservationId: string; giftId: string }
        | { reservation: OwnReservation }
      >(
        tx,
        "guest:" + principal.guestIdentityId,
        `${method} /public/events/${publicId}/gifts/${giftId}/reservation`,
        key,
        data,
        async () => {
          if (method === "DELETE") {
            const id = (data as z.infer<typeof cancelInput>).reservationId;
            const [target] =
              await tx`SELECT id,status FROM app.gift_reservations WHERE id=${id} AND gift_id=${giftId} AND guest_identity_id=${principal.guestIdentityId} FOR UPDATE`;
            if (!target)
              throw new AppError(
                404,
                "RESERVATION_UNAVAILABLE",
                "Этот выбор недоступен.",
              );
            if (target.status === "active") {
              await tx`SELECT app.cancel_reservation(${publicId},${giftId},${principal.guestIdentityId})`;
              await tx`INSERT INTO app.analytics_events(name,event_id,occurred_at) VALUES('gift_unreserved',${event.id},now())`;
            }
            return {
              status: 200,
              body: { cancelled: true, reservationId: id, giftId },
            };
          }
          const [rsvp] =
            await tx`SELECT guest_name FROM app.rsvps WHERE event_id=${event.id} AND guest_identity_id=${principal.guestIdentityId}`;
          const name =
            rsvp?.guest_name ??
            (data as z.infer<typeof reserveInput>).guestName ??
            identity.display_name;
          if (!name)
            throw new AppError(422, "GUEST_NAME_REQUIRED", "Как вас зовут?", {
              guestName: ["Введите имя от 2 до 60 символов."],
            });
          const [old] =
            await tx`SELECT id FROM app.gift_reservations WHERE gift_id=${giftId} AND status='active'`;
          await tx`UPDATE app.guest_identities SET display_name=${name} WHERE id=${principal.guestIdentityId}`;
          const [reservation] =
            await tx`SELECT * FROM app.reserve_gift(${publicId},${giftId},${principal.guestIdentityId})`;
          if (!old)
            await tx`INSERT INTO app.analytics_events(name,event_id,occurred_at) VALUES('gift_reserved',${event.id},now())`;
          return {
            status: old ? 200 : 201,
            body: { reservation: dto(reservation) },
          };
        },
      );
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "23505")
      throw new AppError(
        409,
        "GIFT_ALREADY_RESERVED",
        "Этот подарок только что выбрал другой гость.",
      );
    throw e;
  }
}
