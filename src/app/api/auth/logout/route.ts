import { endpoint, reply } from "@/server/api";
import { organizer, ORG_COOKIE, sessionCookie } from "@/server/auth/sessions";
import { requireMutation } from "@/server/auth/csrf";
import { db } from "@/server/db/client";
export const POST = endpoint(async (request, id) => {
  await requireMutation(request, ORG_COOKIE);
  const p = await organizer();
  await db()`UPDATE app.organizer_sessions SET revoked_at=now() WHERE id=${p.sessionId}`;
  const response = reply({ loggedOut: true }, id);
  sessionCookie(response, ORG_COOKIE, "", 0);
  return response;
});
