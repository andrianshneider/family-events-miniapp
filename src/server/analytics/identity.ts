import "server-only";
import { cookies } from "next/headers";
import { token, tokenHash } from "../auth/crypto";
import type { Transaction } from "../db/client";
import {
  append,
  optional,
  visitor,
  overrideVisitor,
  resolveActor,
  ANALYTICS_COOKIE,
  type Visitor,
} from "./journal";
import { transferOrigin } from "./context";
export async function loginFact(
  tx: Transaction,
  userId: string,
  method: "telegram_mini_app" | "telegram_oidc",
) {
  let raw: string | undefined;
  await optional(tx, async (save) => {
    let v = await visitor(save);
    if (!v) return;
    const guestRaw = (await cookies()).get("__Host-fe_guest")?.value;
    const [g] = guestRaw
      ? await save`SELECT g.linked_user_id FROM app.guest_sessions s JOIN app.guest_identities g ON g.id=s.guest_identity_id WHERE s.token_hash=${tokenHash(guestRaw)} AND s.revoked_at IS NULL AND s.expires_at>now() AND g.merged_into_id IS NULL`
      : [];
    if (
      (v.user_id && v.user_id !== userId) ||
      (g?.linked_user_id && g.linked_user_id !== userId)
    ) {
      raw = token();
      const [fresh] =
        await save`INSERT INTO app.analytics_visitors(token_hash,consent,consented_at,consent_group) VALUES(${tokenHash(raw)},true,now(),${v.consent_group}) RETURNING *`;
      v = fresh as Visitor;
    }
    await overrideVisitor.run(v, async () => {
      await save`UPDATE app.analytics_visitors SET had_organizer_session=true WHERE id=${v!.id}`;
      await transferOrigin(save, userId);
      await append(
        save,
        "user_authenticated",
        { auth_method: method },
        { userId, role: "organizer" },
      );
    });
  });
  return raw;
}
export async function linkedGuest(
  tx: Transaction,
  source: string,
  target: string,
  userId: string,
) {
  await optional(tx, async (save) => {
    const current = await visitor(save);
    if (current && (!current.user_id || current.user_id === userId))
      await save`UPDATE app.analytics_visitors SET suppress_guest_identification=false WHERE id=${current.id}`;
    const visitors =
      await save`SELECT v.* FROM app.analytics_visitors v JOIN app.users u ON u.id=${userId} WHERE v.guest_identity_id IN(${source},${target}) AND v.consent AND v.revoked_at IS NULL AND NOT v.suppress_guest_identification AND (v.user_id IS NULL OR v.user_id=${userId}) AND u.analytics_denied_at IS NULL ORDER BY v.id`;
    for (const row of visitors)
      await overrideVisitor.run(row as Visitor, async () => {
        await resolveActor(save, row as Visitor, undefined, target);
        await save`UPDATE app.analytics_visitors SET guest_identity_id=${target} WHERE id=${row.id}`;
        await transferOrigin(save, userId, target);
      });
    // Retain the earliest proven non-owner touch from either identity, never business data reconciliation.
    const [touch] =
      await save`SELECT g.origin_event_id,g.origin_first_seen_at FROM app.guest_identities g JOIN app.events e ON e.id=g.origin_event_id WHERE g.id IN(${source},${target}) AND e.organizer_id<>${userId} AND g.origin_first_seen_at IS NOT NULL ORDER BY g.origin_first_seen_at LIMIT 1`;
    if (touch) {
      await save`UPDATE app.guest_identities SET origin_event_id=${touch.origin_event_id},origin_first_seen_at=${touch.origin_first_seen_at} WHERE id=${target} AND (origin_first_seen_at IS NULL OR origin_first_seen_at>${touch.origin_first_seen_at})`;
      await save`UPDATE app.users SET origin_event_id=${touch.origin_event_id},origin_first_seen_at=${touch.origin_first_seen_at} WHERE id=${userId} AND analytics_denied_at IS NULL AND (origin_first_seen_at IS NULL OR origin_first_seen_at>${touch.origin_first_seen_at})`;
    }
  });
}
export async function resetAnalytics(tx: Transaction) {
  let raw: string | undefined;
  await optional(tx, async (save) => {
    const v = await visitor(save);
    if (!v) return;
    raw = token();
    await save`INSERT INTO app.analytics_visitors(token_hash,consent,consented_at,suppress_guest_identification,consent_group) VALUES(${tokenHash(raw)},true,now(),true,${v.consent_group})`;
  });
  return raw;
}
export async function analyticsCookie(
  response: import("next/server").NextResponse,
  raw?: string,
  reset = false,
) {
  const { sessionCookie } = await import("../auth/sessions");
  sessionCookie(
    response,
    "__Host-fe_analytics_reset",
    reset ? "1" : "",
    reset ? 180 * 86400 : 0,
  );
  if (raw) {
    sessionCookie(response, ANALYTICS_COOKIE, raw, 180 * 86400);
  }
}
