import { cookies } from "next/headers";
import { z } from "zod";
import { endpoint, reply, input } from "@/server/api";
import { requireOrigin } from "@/server/auth/csrf";
import { limit } from "@/server/auth/rate-limit";
import {
  organizer,
  GUEST_COOKIE,
  GUEST_TTL,
  sessionCookie,
} from "@/server/auth/sessions";
import { bootstrapGuest } from "@/server/services/guest-session";
import { AppError } from "@/server/errors";
export const POST = endpoint(async (request, id) => {
  requireOrigin(request);
  await limit(
    request,
    "guest_session",
    Number(process.env.GUEST_SESSION_RATE_LIMIT ?? 20),
  );
  const options = await input(
    request,
    z.object({ restart: z.boolean().optional() }).strict().default({}),
    16384,
    true,
  );
  let userId: string | null = null;
  try {
    userId = (await organizer()).userId;
  } catch (error) {
    if (!(error instanceof AppError && error.status === 401)) throw error;
  }
  const raw = (await cookies()).get(GUEST_COOKIE)?.value;
  const result = await bootstrapGuest(raw, userId, options.restart === true);
  const response = reply(
    { created: result.created },
    id,
    result.created ? 201 : 200,
  );
  if (result.created)
    sessionCookie(response, GUEST_COOKIE, result.raw, GUEST_TTL);
  return response;
});
