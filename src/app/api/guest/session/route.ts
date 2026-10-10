import { endpoint, reply } from "@/server/api";
import { requireOrigin } from "@/server/auth/csrf";
import { limit } from "@/server/auth/rate-limit";
import {
  guest,
  organizer,
  createGuestSession,
  GUEST_COOKIE,
  GUEST_TTL,
  sessionCookie,
} from "@/server/auth/sessions";
import { transaction } from "@/server/db/client";
import { AppError } from "@/server/errors";
export const POST = endpoint(async (request, id) => {
  requireOrigin(request);
  await limit(
    request,
    "guest_session",
    Number(process.env.GUEST_SESSION_RATE_LIMIT ?? 20),
  );
  try {
    await guest();
    return reply({ created: false }, id);
  } catch (e) {
    if (!(e instanceof AppError && e.status === 401)) throw e;
  }
  let userId: string | null = null;
  try {
    userId = (await organizer()).userId;
  } catch (e) {
    if (!(e instanceof AppError && e.status === 401)) throw e;
  }
  const raw = await transaction(async (tx) => {
    const [identity] = userId
      ? await tx`INSERT INTO app.guest_identities(linked_user_id) VALUES(${userId}) ON CONFLICT(linked_user_id) DO UPDATE SET linked_user_id=excluded.linked_user_id RETURNING id`
      : await tx`INSERT INTO app.guest_identities DEFAULT VALUES RETURNING id`;
    return createGuestSession(tx, identity.id);
  });
  const response = reply({ created: true }, id, 201);
  sessionCookie(response, GUEST_COOKIE, raw, GUEST_TTL);
  return response;
});
