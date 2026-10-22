import { resetAnalytics, analyticsCookie } from "@/server/analytics/identity";
import { endpoint, reply } from "@/server/api";
import {
  organizer,
  ORG_COOKIE,
  REAUTH_COOKIE,
  sessionCookie,
} from "@/server/auth/sessions";
import { requireMutation } from "@/server/auth/csrf";
import { transaction } from "@/server/db/client";
import { token, tokenHash } from "@/server/auth/crypto";
export const POST = endpoint(async (request, id) => {
  await requireMutation(request, ORG_COOKIE);
  const p = await organizer();
  const reauth = token();
  const granted = await transaction(async (tx) => {
    const [session] =
      await tx`UPDATE app.organizer_sessions SET revoked_at=now() WHERE id=${p.sessionId} AND revoked_at IS NULL RETURNING token_hash`;
    if (!session) return false;
    const receipts =
      await tx`UPDATE app.mini_app_logins SET reauth_hash=${tokenHash(reauth)} WHERE session_hash=${session.token_hash} AND expires_at>now() RETURNING digest`;
    return receipts.length > 0;
  });
  const analyticsRaw = await transaction((tx) => resetAnalytics(tx));
  const response = reply({ loggedOut: true }, id);
  await analyticsCookie(response, analyticsRaw, true);
  sessionCookie(response, ORG_COOKIE, "", 0);
  sessionCookie(
    response,
    REAUTH_COOKIE,
    granted ? reauth : "",
    granted ? 300 : 0,
  );
  return response;
});
