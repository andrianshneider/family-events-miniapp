import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Gift, Wishlist } from "@/lib/wishlist";
import type { OrganizerPrincipal } from "@/types/principal";
import {
  giftInput,
  giftUpdateInput,
  giftDeleteInput,
  wishlistInput,
} from "@/lib/validation";
import { transaction, type Transaction } from "../db/client";
import { ownedEvent, expectedVersion } from "../db/authorization";
import { idempotent } from "../db/idempotency";
import { AppError, unavailable } from "../errors";
import { validPublicId } from "./public-events";
import { setting } from "../config";
const cursorSchema = z
  .object({
    context: z.string(),
    sortOrder: z.number().int(),
    createdAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();
export function wishlistQuery(url: URL) {
  const parsed = z
    .object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().max(600).optional(),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success)
    throw new AppError(
      422,
      "INVALID_WISHLIST_QUERY",
      "Обновите список подарков.",
    );
  return parsed.data;
}
const giftUnavailable = () =>
  new AppError(404, "GIFT_UNAVAILABLE", "Подарок недоступен или был удалён.");
function projection(
  row: Record<string, unknown>,
  key: string,
  owner: boolean,
  hide: boolean,
): Gift {
  const result: Gift = {
    id: String(row.id),
    title: String(row.title),
    externalUrl: row.external_url as string | null,
    amount: row.amount == null ? null : String(row.amount),
    currency: row.currency as Gift["currency"],
    comment: row.comment as string | null,
    imageUrl: row.has_image
      ? `/api/v1/${owner ? "events" : "public/events"}/${key}/gifts/${row.id}/image?v=${row.version}`
      : null,
    reserved: Boolean(row.reserved),
    version: Number(row.version),
  };
  if (owner) result.imageAssetId = row.image_asset_id as string | null;
  if (owner && !hide)
    result.reserverDisplayName = row.reserver_display_name as string | null;
  return result;
}
async function parent(
  tx: Transaction,
  key: string,
  principal?: OrganizerPrincipal,
) {
  if (!principal) validPublicId(key);
  const [event] = principal
    ? await tx`SELECT e.id,e.title,e.version,w.id AS wishlist_id,w.hide_reserver_identity FROM app.events e JOIN app.wishlists w ON w.event_id=e.id WHERE e.id=${key} AND e.organizer_id=${principal.userId} AND e.deleted_at IS NULL FOR SHARE OF e`
    : await tx`SELECT e.id,e.title,e.version,w.id AS wishlist_id,w.hide_reserver_identity FROM app.events e JOIN app.wishlists w ON w.event_id=e.id WHERE e.public_id=${key} AND e.deleted_at IS NULL FOR SHARE OF e`;
  if (!event) throw unavailable();
  return event;
}
export async function readWishlist(
  key: string,
  options: { limit?: number; cursor?: string } = {},
  principal?: OrganizerPrincipal,
): Promise<Wishlist> {
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (options.cursor)
    try {
      if (!/^[\w-]+$/.test(options.cursor) || options.cursor.length > 600)
        throw Error();
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(options.cursor, "base64url").toString()),
      );
      if (cursor.context !== key) throw Error();
    } catch {
      throw new AppError(422, "INVALID_CURSOR", "Обновите список подарков.");
    }
  return transaction(async (tx) => {
    const e = await parent(tx, key, principal),
      limit = options.limit ?? 20;
    const [total] =
      await tx`SELECT count(*)::int AS total,coalesce(sum(g.version),0)::text AS versions,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM app.gift_reservations r WHERE r.gift_id=g.id AND r.status='active'))::int AS reserved,
      coalesce((SELECT sum(r.version)::text FROM app.gift_reservations r JOIN app.gifts rg ON rg.id=r.gift_id WHERE rg.wishlist_id=${e.wishlist_id} AND rg.deleted_at IS NULL),'0') AS reservation_versions,
      CASE WHEN ${Boolean(principal)} AND NOT ${e.hide_reserver_identity} THEN (SELECT coalesce(jsonb_agg(jsonb_build_array(ng.id,i.display_name) ORDER BY ng.id),'[]'::jsonb)::text FROM app.gifts ng JOIN app.gift_reservations nr ON nr.gift_id=ng.id AND nr.status='active' JOIN app.guest_identities i ON i.id=nr.guest_identity_id WHERE ng.wishlist_id=${e.wishlist_id} AND ng.deleted_at IS NULL) ELSE NULL END AS private_names
      FROM app.gifts g WHERE g.wishlist_id=${e.wishlist_id} AND g.deleted_at IS NULL`;
    // CASE gates the name in SQL. Public and Surprise ON never select a reserver identity into the DTO.
    const rows =
      await tx`SELECT g.id,g.title,g.external_url,g.amount::text,g.currency,g.comment,g.version,g.image_asset_id,g.sort_order,to_char(g.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
 EXISTS(SELECT 1 FROM app.media_assets m WHERE m.id=g.image_asset_id AND m.state='ready' AND m.owner_user_id=(SELECT organizer_id FROM app.events WHERE id=${e.id})) AS has_image,
 EXISTS(SELECT 1 FROM app.gift_reservations r WHERE r.gift_id=g.id AND r.status='active') AS reserved,
 CASE WHEN ${Boolean(principal)} AND NOT ${e.hide_reserver_identity} THEN (SELECT i.display_name FROM app.gift_reservations r JOIN app.guest_identities i ON i.id=r.guest_identity_id WHERE r.gift_id=g.id AND r.status='active') ELSE NULL END AS reserver_display_name
 FROM app.gifts g WHERE g.wishlist_id=${e.wishlist_id} AND g.deleted_at IS NULL AND (${cursor?.createdAt ?? null}::timestamptz IS NULL OR (g.sort_order,g.created_at,g.id)>(${cursor?.sortOrder ?? null}::int,${cursor?.createdAt ?? null}::timestamptz,${cursor?.id ?? null}::uuid)) ORDER BY g.sort_order,g.created_at,g.id LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit),
      last = page.at(-1);
    const result: Wishlist = {
      event: { title: e.title },
      total: total.total,
      reservedTotal: total.reserved,
      revision: createHmac("sha256", setting("SESSION_SECRET"))
        .update(
          "wishlist-revision:" +
            JSON.stringify([
              key,
              e.version,
              total.total,
              total.versions,
              total.reserved,
              total.reservation_versions,
              total.private_names ?? null,
            ]),
        )
        .digest("base64url"),
      gifts: page.map((r) =>
        projection(r, key, Boolean(principal), e.hide_reserver_identity),
      ),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                context: key,
                sortOrder: last.sort_order,
                createdAt: last.cursor_time,
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
    if (principal) {
      result.version = e.version;
      result.hideReserverIdentity = e.hide_reserver_identity;
    }
    return result;
  });
}
export async function readGift(
  key: string,
  giftId: string,
  principal?: OrganizerPrincipal,
): Promise<Gift> {
  return transaction(async (tx) => {
    const e = await parent(tx, key, principal);
    const [g] =
      await tx`SELECT g.id,g.title,g.external_url,g.amount::text,g.currency,g.comment,g.version,g.image_asset_id,
 EXISTS(SELECT 1 FROM app.media_assets m WHERE m.id=g.image_asset_id AND m.state='ready' AND m.owner_user_id=(SELECT organizer_id FROM app.events WHERE id=${e.id})) AS has_image,
 EXISTS(SELECT 1 FROM app.gift_reservations r WHERE r.gift_id=g.id AND r.status='active') AS reserved,
 CASE WHEN ${Boolean(principal)} AND NOT ${e.hide_reserver_identity} THEN (SELECT i.display_name FROM app.gift_reservations r JOIN app.guest_identities i ON i.id=r.guest_identity_id WHERE r.gift_id=g.id AND r.status='active') ELSE NULL END AS reserver_display_name
 FROM app.gifts g WHERE g.id=${giftId} AND g.wishlist_id=${e.wishlist_id} AND g.deleted_at IS NULL`;
    if (!g) throw giftUnavailable();
    return projection(g, key, Boolean(principal), e.hide_reserver_identity);
  });
}
async function imageGuard(
  tx: Transaction,
  principal: OrganizerPrincipal,
  assetId: string | null | undefined,
) {
  if (!assetId) return;
  const [asset] =
    await tx`SELECT id FROM app.media_assets WHERE id=${assetId} AND owner_user_id=${principal.userId} AND state='ready' FOR SHARE`;
  if (!asset)
    throw new AppError(
      422,
      "INVALID_GIFT_IMAGE",
      "Выберите завершённую загрузку своего изображения.",
      { imageAssetId: ["Изображение недоступно."] },
    );
}
function normalize(data: z.infer<typeof giftInput>) {
  const [integer, fraction = "00"] = data.amount?.split(".") ?? [];
  return {
    ...data,
    externalUrl: data.externalUrl?.trim() || null,
    comment: data.comment?.trim() || null,
    imageAssetId: data.imageAssetId ?? null,
    amount: integer ? `${BigInt(integer)}.${fraction.padEnd(2, "0")}` : null,
    currency: data.currency ?? null,
  };
}
export async function createGift(
  principal: OrganizerPrincipal,
  eventId: string,
  data: z.infer<typeof giftInput>,
  key: string,
) {
  return transaction(async (tx) => {
    await ownedEvent(tx, principal, eventId);
    const n = normalize(data);
    return idempotent(
      tx,
      "organizer:" + principal.userId,
      `POST /events/${eventId}/gifts`,
      key,
      n,
      async () => {
        await imageGuard(tx, principal, n.imageAssetId);
        const [w] =
          await tx`SELECT id FROM app.wishlists WHERE event_id=${eventId}`;
        if (!w) throw unavailable();
        const [g] =
          await tx`INSERT INTO app.gifts(wishlist_id,title,external_url,amount,currency,comment,image_asset_id) VALUES(${w.id},${n.title},${n.externalUrl},${n.amount},${n.currency},${n.comment},${n.imageAssetId}) RETURNING id,version`;
        // P1 wishlist_item_added remains deferred; no unconsented legacy producer.
        return {
          status: 201,
          body: { id: g.id as string, version: g.version as number },
        };
      },
    );
  });
}
export async function updateGift(
  principal: OrganizerPrincipal,
  eventId: string,
  giftId: string,
  data: z.infer<typeof giftUpdateInput>,
  key: string,
) {
  return transaction(async (tx) => {
    await ownedEvent(tx, principal, eventId);
    const n = normalize(data.fields);
    return idempotent(
      tx,
      "organizer:" + principal.userId,
      `PATCH /events/${eventId}/gifts/${giftId}`,
      key,
      { expectedVersion: data.expectedVersion, fields: n },
      async () => {
        const [g] =
          await tx`SELECT g.* FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id WHERE g.id=${giftId} AND w.event_id=${eventId} AND g.deleted_at IS NULL FOR UPDATE OF g`;
        if (!g) throw giftUnavailable();
        expectedVersion(g.version, data.expectedVersion);
        await imageGuard(tx, principal, n.imageAssetId);
        const changed =
          g.title !== n.title ||
          (g.external_url ?? null) !== n.externalUrl ||
          (g.amount == null ? null : String(g.amount)) !== n.amount ||
          (g.currency ?? null) !== n.currency ||
          (g.comment ?? null) !== n.comment ||
          (g.image_asset_id ?? null) !== n.imageAssetId;
        if (changed)
          await tx`UPDATE app.gifts SET title=${n.title},external_url=${n.externalUrl},amount=${n.amount},currency=${n.currency},comment=${n.comment},image_asset_id=${n.imageAssetId},version=version+1 WHERE id=${giftId}`;
        return {
          status: 200,
          body: { id: giftId, version: g.version + (changed ? 1 : 0) },
        };
      },
    );
  });
}
export async function deleteGift(
  principal: OrganizerPrincipal,
  eventId: string,
  giftId: string,
  data: z.infer<typeof giftDeleteInput>,
  key: string,
) {
  return transaction(async (tx) => {
    // Retained parent allows a committed delete receipt to be retried after Event deletion.
    const [e] =
      await tx`SELECT id,deleted_at FROM app.events WHERE id=${eventId} AND organizer_id=${principal.userId} FOR UPDATE`;
    if (!e) throw unavailable();
    return idempotent(
      tx,
      "organizer:" + principal.userId,
      `DELETE /events/${eventId}/gifts/${giftId}`,
      key,
      data,
      async () => {
        if (e.deleted_at) throw unavailable();
        const [g] =
          await tx`SELECT g.id,g.version,g.deleted_at FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id WHERE g.id=${giftId} AND w.event_id=${eventId} FOR UPDATE OF g`;
        if (!g) throw giftUnavailable();
        if (g.deleted_at)
          return {
            status: 200,
            body: { id: giftId, version: g.version as number, deleted: true },
          };
        expectedVersion(g.version, data.expectedVersion);
        const active =
          await tx`SELECT id FROM app.gift_reservations WHERE gift_id=${giftId} AND status='active' FOR UPDATE`;
        if (active.length && !data.confirmReserved)
          throw new AppError(
            409,
            "CONFIRM_RESERVED_GIFT_DELETE",
            "Этот подарок уже выбрал один из гостей. Всё равно удалить его?",
          );
        await tx`UPDATE app.gift_reservations SET status='cancelled',cancelled_at=now(),cancel_reason='gift_deleted',version=version+1 WHERE gift_id=${giftId} AND status='active'`;
        await tx`UPDATE app.gifts SET deleted_at=now(),version=version+1 WHERE id=${giftId}`;
        return {
          status: 200,
          body: { id: giftId, version: g.version + 1, deleted: true },
        };
      },
    );
  });
}
export async function updateWishlist(
  principal: OrganizerPrincipal,
  eventId: string,
  data: z.infer<typeof wishlistInput>,
  key: string,
) {
  return transaction(async (tx) => {
    const e = await ownedEvent(tx, principal, eventId);
    return idempotent(
      tx,
      "organizer:" + principal.userId,
      `PATCH /events/${eventId}/wishlist`,
      key,
      data,
      async () => {
        expectedVersion(e.version, data.expectedVersion);
        const [w] =
          await tx`SELECT hide_reserver_identity FROM app.wishlists WHERE event_id=${eventId} FOR UPDATE`;
        if (!w) throw unavailable();
        const changed = w.hide_reserver_identity !== data.hideReserverIdentity;
        if (changed) {
          await tx`UPDATE app.wishlists SET hide_reserver_identity=${data.hideReserverIdentity} WHERE event_id=${eventId}`;
          await tx`UPDATE app.events SET version=version+1 WHERE id=${eventId}`;
        }
        return {
          status: 200,
          body: {
            hideReserverIdentity: data.hideReserverIdentity,
            version: e.version + (changed ? 1 : 0),
          },
        };
      },
    );
  });
}
