import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cookies, headers } from "next/headers";
import { randomUUID } from "node:crypto";
import type { Transaction } from "../db/client";
import { tokenHash } from "../auth/crypto";
import { log } from "../log";
import { properties, platform, type EventName } from "@/lib/analytics/contract";
export const ANALYTICS_COOKIE = "__Host-fe_analytics";
export const enabled = () =>
  process.env.ANALYTICS_ENABLED === "true" &&
  process.env.APP_ENV !== "production";
export type Visitor = {
  id: string;
  consent_group: string;
  had_organizer_session?: boolean;
  last_platform?: string;
  traffic_class?: string;
  user_id: string | null;
  guest_identity_id: string | null;
  suppress_guest_identification: boolean;
  consent: boolean;
  origin_event_id: string | null;
  origin_first_seen_at: Date | null;
};
export const overrideVisitor = new AsyncLocalStorage<Visitor>();
export async function visitor(tx: Transaction) {
  if (overrideVisitor.getStore()) return overrideVisitor.getStore()!;
  const raw = (await cookies()).get(ANALYTICS_COOKIE)?.value;
  if (!raw || !/^[\w-]{43}$/.test(raw)) return null;
  const [v] =
    await tx`SELECT v.* FROM app.analytics_visitors v LEFT JOIN app.users u ON u.id=v.user_id WHERE v.token_hash=${tokenHash(raw)} AND v.consent AND v.revoked_at IS NULL AND u.analytics_denied_at IS NULL FOR UPDATE OF v`;
  return (v as Visitor | undefined) ?? null;
}
export async function optional(
  tx: Transaction,
  work: (save: Transaction) => Promise<void>,
) {
  if (!enabled()) return;
  try {
    await tx.savepoint(async (save) => {
      await work(save);
    });
  } catch {
    log("analytics_journal_lost", { code: "JOURNAL_FAILED" });
  }
}
export async function append(
  tx: Transaction,
  name: EventName,
  value: unknown,
  options: {
    userId?: string;
    guestId?: string;
    role: "organizer" | "guest" | "anonymous";
    id?: string;
    source?: "client" | "server";
    occurredAt?: string;
    clientPlatform?: string;
    authenticated?: boolean;
    clockSkew?: boolean;
  },
) {
  const v = await visitor(tx);
  if (!v) return;
  const actor = await resolveActor(tx, v, options.userId, options.guestId);
  if (!actor) return;
  const props = properties(name, value),
    id = options.id ?? randomUUID();
  const h = await headers();
  const origin =
    platform.safeParse(
      options.clientPlatform ?? h.get("x-fe-platform") ?? v.last_platform,
    ).data ?? "unknown";
  const [traffic] = actor.userId
    ? await tx`SELECT classification FROM app.analytics_traffic WHERE user_id=${actor.userId}`
    : [];
  const orgRaw = (await cookies()).get("__Host-fe_org")?.value;
  const orgSession =
    orgRaw && !options.userId
      ? await tx`SELECT id FROM app.organizer_sessions WHERE token_hash=${tokenHash(orgRaw)} AND expires_at>now() AND revoked_at IS NULL`
      : [];
  const data = {
    ...props,
    schema_version: "1.0",
    analytics_event_id: id,
    occurred_at: options.occurredAt ?? new Date().toISOString(),
    environment: process.env.APP_ENV ?? "local",
    app_version: /^[a-f\d]{7,40}$/i.test(
      process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.APP_VERSION ?? "",
    )
      ? (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.APP_VERSION!)
      : "unknown",
    source: options.source ?? "server",
    platform: options.source === "client" ? origin : "server",
    origin_platform: origin,
    participant_role: options.role,
    is_authenticated:
      options.authenticated ?? (!!options.userId || orgSession.length > 0),
    traffic_class: traffic?.classification ?? v.traffic_class ?? "unknown",
    clock_skew: options.clockSkew ?? false,
  };
  await tx`INSERT INTO app.analytics_events(id,name,event_id,user_id,guest_identity_id,anonymous_visitor_id,visitor_id,distinct_id,schema_version,properties,occurred_at,client_event_id,delivery_status) VALUES(${id},${name},${"event_id" in props ? (props.event_id ?? null) : null},${actor.userId ?? null},${options.guestId ?? null},${v.id},${v.id},${actor.distinct},'1.0',${tx.json(data)},${data.occurred_at},${options.source === "client" ? id : null},'pending') ON CONFLICT DO NOTHING`;
}
export async function resolveActor(
  tx: Transaction,
  v: Visitor,
  userId?: string,
  guestId?: string,
) {
  let linked: string | undefined;
  if (guestId) {
    const [g] =
      await tx`SELECT linked_user_id FROM app.guest_identities WHERE id=${guestId} AND merged_into_id IS NULL`;
    linked = g?.linked_user_id;
  }
  const uid = userId ?? (!v.suppress_guest_identification ? linked : undefined);
  if (uid) {
    if (v.user_id && v.user_id !== uid) return null; // Never merge identified accounts.
    const [allowed] =
      await tx`SELECT id,created_at,origin_event_id,origin_first_seen_at,EXISTS(SELECT 1 FROM app.events e WHERE e.organizer_id=app.users.id) AS has_created FROM app.users WHERE id=${uid} AND analytics_denied_at IS NULL`;
    if (!allowed) return null;
    if (!v.user_id) {
      await tx`UPDATE app.analytics_visitors SET user_id=${uid} WHERE id=${v.id} AND user_id IS NULL`;
      const id = randomUUID();
      await tx`INSERT INTO app.analytics_events(id,name,visitor_id,distinct_id,user_id,schema_version,properties,occurred_at,delivery_status) VALUES(${id},'$identify',${v.id},${uid},${uid},'1.0',${tx.json({ $anon_distinct_id: v.id, $set_once: { signup_date: new Date(allowed.created_at).toISOString(), ...(v.last_platform && v.last_platform !== "unknown" ? { first_platform: v.last_platform } : {}) }, $set: { has_created_event: allowed.has_created, ...(allowed.origin_event_id ? { first_guest_origin_event_id: allowed.origin_event_id, first_guest_seen_at: new Date(allowed.origin_first_seen_at).toISOString() } : {}) } })},now(),'pending')`;
    }
  }
  if (guestId && (!linked || !v.user_id || linked === v.user_id))
    await tx`UPDATE app.analytics_visitors SET guest_identity_id=${guestId} WHERE id=${v.id}`;
  return {
    distinct:
      uid ?? (v.suppress_guest_identification ? v.id : (v.user_id ?? v.id)),
    userId: uid ?? (v.suppress_guest_identification ? undefined : v.user_id),
  };
}
export async function success(
  tx: Transaction,
  name: EventName,
  value: unknown,
  userId?: string,
  guestId?: string,
) {
  await optional(tx, async (save) => {
    const h = await headers();
    const extra: Record<string, string> = {};
    for (const [header, key] of [
      ["x-fe-form", "form_instance_id"],
      ["x-fe-attempt", "attempt_id"],
    ]) {
      const val = h.get(header);
      if (
        val &&
        /^[\da-f-]{36}$/i.test(val) &&
        (name === "event_created" || key === "attempt_id")
      )
        extra[key] = val;
    }
    await append(
      save,
      name,
      { ...(value as object), ...extra },
      { userId, guestId, role: userId ? "organizer" : "guest" },
    );
  });
}
export async function actorRelation(
  tx: Transaction,
  eventId: string,
  userId?: string,
  guestId?: string,
) {
  const [r] =
    await tx`SELECT e.organizer_id,g.linked_user_id FROM app.events e LEFT JOIN app.guest_identities g ON g.id=${guestId ?? null} WHERE e.id=${eventId}`;
  const uid = userId ?? r?.linked_user_id;
  return !uid
    ? "unknown"
    : uid === r?.organizer_id
      ? "known_owner"
      : "known_non_owner";
}
