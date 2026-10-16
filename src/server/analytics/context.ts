import "server-only";
import { z } from "zod";
import { organizer, guest } from "../auth/sessions";
import type { Transaction } from "../db/client";
import { append, actorRelation, resolveActor, visitor } from "./journal";
import { AppError } from "../errors";
export async function principals() {
  let userId: string | undefined, guestId: string | undefined;
  try {
    userId = (await organizer()).userId;
  } catch (e) {
    if (!(e instanceof AppError && e.status === 401)) throw e;
  }
  try {
    guestId = (await guest()).guestIdentityId;
  } catch (e) {
    if (!(e instanceof AppError && e.status === 401)) throw e;
  }
  return { userId, guestId };
}
export const locator = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("public"), id: z.string().regex(/^[\w-]{22}$/) })
    .strict(),
  z.object({ kind: z.literal("management"), id: z.uuid() }).strict(),
]);
export async function context(tx: Transaction, loc?: z.infer<typeof locator>) {
  const p = await principals(),
    v = await visitor(tx);
  if (!v) return null;
  if (v.had_organizer_session && !p.userId) return null;
  const a = await resolveActor(tx, v, p.userId, p.guestId);
  if (!a) return null;
  if (p.userId)
    await tx`UPDATE app.analytics_visitors SET had_organizer_session=true WHERE id=${v.id}`;
  let eventId: string | undefined,
    relation: "known_owner" | "known_non_owner" | "unknown" = "unknown";
  if (loc) {
    const [e] =
      loc.kind === "public"
        ? await tx`SELECT id FROM app.events WHERE public_id=${loc.id} AND deleted_at IS NULL`
        : await tx`SELECT id FROM app.events WHERE id=${loc.id} AND organizer_id=${p.userId ?? null} AND deleted_at IS NULL`;
    if (!e) throw new AppError(404, "EVENT_UNAVAILABLE", "Событие недоступно.");
    eventId = e.id;
    relation = await actorRelation(tx, e.id, p.userId, p.guestId);
  }
  return {
    ...p,
    visitor: v,
    distinctId: a.distinct,
    identified: !!a.userId,
    eventId,
    relation,
    isAuthenticated: !!p.userId,
    role:
      loc?.kind === "public"
        ? "guest"
        : p.userId
          ? "organizer"
          : p.guestId
            ? "guest"
            : "anonymous",
  } as const;
}
export async function firstTouch(
  tx: Transaction,
  eventId: string,
  userId?: string,
  guestId?: string,
) {
  if ((await actorRelation(tx, eventId, userId, guestId)) === "known_owner")
    return;
  const v = await visitor(tx);
  if (!v) return;
  await tx`UPDATE app.analytics_visitors SET origin_event_id=${eventId},origin_first_seen_at=now() WHERE id=${v.id} AND origin_first_seen_at IS NULL`;
  await transferOrigin(tx, userId, guestId);
}
export async function transferOrigin(
  tx: Transaction,
  userId?: string,
  guestId?: string,
) {
  const v = await visitor(tx);
  if (!v) return;
  if (v.suppress_guest_identification && !userId) return;
  if (!userId && guestId && !v.suppress_guest_identification) {
    const [g] =
      await tx`SELECT linked_user_id FROM app.guest_identities WHERE id=${guestId} AND merged_into_id IS NULL`;
    if (g?.linked_user_id && (!v.user_id || v.user_id === g.linked_user_id))
      userId = g.linked_user_id;
  }
  if (
    userId &&
    !(
      await tx`SELECT id FROM app.users WHERE id=${userId} AND analytics_denied_at IS NULL`
    ).length
  )
    return;
  if (guestId)
    await tx`UPDATE app.guest_identities g SET origin_event_id=v.origin_event_id,origin_first_seen_at=v.origin_first_seen_at FROM app.analytics_visitors v,app.events e WHERE v.id=${v.id} AND e.id=v.origin_event_id AND g.id=${guestId} AND (g.linked_user_id IS NULL OR g.linked_user_id<>e.organizer_id) AND v.origin_first_seen_at IS NOT NULL AND (g.origin_first_seen_at IS NULL OR g.origin_first_seen_at>v.origin_first_seen_at)`;
  if (userId)
    await tx`UPDATE app.users u SET origin_event_id=v.origin_event_id,origin_first_seen_at=v.origin_first_seen_at FROM app.analytics_visitors v,app.events e WHERE u.id=${userId} AND v.id=${v.id} AND e.id=v.origin_event_id AND e.organizer_id<>u.id AND v.origin_first_seen_at IS NOT NULL AND (u.origin_first_seen_at IS NULL OR u.origin_first_seen_at>v.origin_first_seen_at)`;
}
export async function collect(tx: Transaction, data: unknown) {
  const { clientInput, properties } = await import("@/lib/analytics/contract");
  const input = clientInput.parse(data),
    c = await context(tx, input.locator);
  if (!c) return;
  const received = new Date();
  const skew =
    Math.abs(received.getTime() - Date.parse(input.occurredAt)) > 5 * 60000;
  await tx`UPDATE app.analytics_visitors SET last_platform=${input.platform} WHERE id=${c.visitor.id}`;
  const props = { ...input.properties };
  // Client event_id and actor_relation are never authoritative.
  delete props.event_id;
  delete props.actor_relation;
  if (c.eventId) props.event_id = c.eventId;
  if (input.name === "event_viewed") {
    props.actor_relation = c.relation;
    if (
      props.view_mode !==
      (input.locator?.kind === "public" ? "public" : "management")
    )
      throw new AppError(400, "INVALID_ANALYTICS", "Неверный контекст.");
  }
  if (
    [
      "event_creation_started",
      "share_initiated",
      "share_result",
      "invitation_link_copied",
    ].includes(input.name) &&
    !c.userId
  )
    throw new AppError(401, "UNAUTHENTICATED", "Требуется вход.");
  properties(input.name, props);
  await append(tx, input.name, props, {
    id: input.id,
    userId: c.userId,
    guestId: c.guestId,
    role: c.role,
    source: "client",
    clientPlatform: input.platform,
    occurredAt: skew ? received.toISOString() : input.occurredAt,
    authenticated: c.isAuthenticated,
    clockSkew: skew,
  });
  if (
    input.name === "event_viewed" &&
    input.locator?.kind === "public" &&
    c.eventId
  )
    await firstTouch(tx, c.eventId, c.userId, c.guestId);
}
