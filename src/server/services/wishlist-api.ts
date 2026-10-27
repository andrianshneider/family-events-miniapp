import "server-only";
import { z } from "zod";
import { organizer, ORG_COOKIE } from "../auth/sessions";
import { requireMutation } from "../auth/csrf";
import { limit } from "../auth/rate-limit";
export async function wishlistMutation(request: Request) {
  const principal = await organizer();
  await requireMutation(request, ORG_COOKIE);
  await limit(
    request,
    "gift_write",
    Number(process.env.GIFT_WRITE_RATE_LIMIT ?? 30),
    principal.sessionId,
  );
  return principal;
}
export async function publicWishlistLimit(request: Request) {
  await limit(
    request,
    "public",
    Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
  );
}
export const wishlistIds = z.object({ eventId: z.uuid(), giftId: z.uuid() });
