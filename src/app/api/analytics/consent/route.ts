import { z } from "zod";
import { cookies } from "next/headers";
import { endpoint, input, reply } from "@/server/api";
import { requireOrigin } from "@/server/auth/csrf";
import { sessionCookie } from "@/server/auth/sessions";
import { token, tokenHash } from "@/server/auth/crypto";
import { transaction } from "@/server/db/client";
import { enabled, ANALYTICS_COOKIE } from "@/server/analytics/journal";
import { principals } from "@/server/analytics/context";
import { limit } from "@/server/auth/rate-limit";
export const POST = endpoint(async (req, id) => {
  requireOrigin(req);
  await limit(req, "analytics_consent", 30);
  const { allow } = await input(
    req,
    z.object({ allow: z.boolean() }).strict(),
    256,
  );
  const old = (await cookies()).get(ANALYTICS_COOKIE)?.value,
    p = await principals();
  const raw = token();
  const suppress =
    !!(await cookies()).get("__Host-fe_analytics_reset") && !p.userId;
  await transaction(async (tx) => {
    if (old && /^[\w-]{43}$/.test(old)) {
      const [v] =
        await tx`UPDATE app.analytics_visitors SET consent=false,revoked_at=now() WHERE token_hash=${tokenHash(old)} RETURNING id,user_id,consent_group`;
      if (v) {
        await tx`UPDATE app.analytics_visitors SET consent=false,revoked_at=now() WHERE consent_group=${v.consent_group}`;
        await tx`UPDATE app.analytics_events SET delivery_status='suppressed',locked_until=NULL,lease_id=NULL WHERE visitor_id IN(SELECT id FROM app.analytics_visitors WHERE consent_group=${v.consent_group}) AND delivery_status IN('pending','processing')`;
      }
      if (!allow && v?.user_id)
        await tx`UPDATE app.users SET analytics_denied_at=now() WHERE id=${v.user_id}`;
    }
    if (p.userId)
      await tx`UPDATE app.users SET analytics_denied_at=${allow ? null : new Date()} WHERE id=${p.userId}`;
    if (allow && !suppress && !p.userId && p.guestId)
      await tx`UPDATE app.users SET analytics_denied_at=NULL WHERE id IN(SELECT linked_user_id FROM app.guest_identities WHERE id=${p.guestId} AND merged_into_id IS NULL)`;
    if (allow && enabled())
      await tx`INSERT INTO app.analytics_visitors(token_hash,consent,consented_at,suppress_guest_identification) VALUES(${tokenHash(raw)},true,now(),${suppress})`;
  });
  const response = reply(
    { enabled: enabled(), consent: allow && enabled() },
    id,
  );
  sessionCookie(
    response,
    "__Host-fe_analytics_choice",
    allow ? "allowed" : "denied",
    180 * 86400,
  );
  sessionCookie(
    response,
    ANALYTICS_COOKIE,
    allow && enabled() ? raw : "",
    allow && enabled() ? 180 * 86400 : 0,
  );
  return response;
});
