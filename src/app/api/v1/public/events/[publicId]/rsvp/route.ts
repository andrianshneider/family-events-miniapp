import { endpoint, reply, input } from "@/server/api";
import { guest, GUEST_COOKIE } from "@/server/auth/sessions";
import { requireMutation } from "@/server/auth/csrf";
import { limit } from "@/server/auth/rate-limit";
import { rsvpInput } from "@/lib/validation";
import { guestContext, saveRsvp } from "@/server/services/rsvps";
export const GET = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    await limit(
      req,
      "public",
      Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
    );
    const result = await guestContext((await context.params).publicId);
    return reply({ rsvp: result.rsvp, sessionState: result.sessionState }, id);
  })(request);
export const PUT = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    const principal = await guest();
    await requireMutation(req, GUEST_COOKIE);
    await limit(
      req,
      "guest_write_session",
      Number(process.env.GUEST_WRITE_SESSION_RATE_LIMIT ?? 30),
      principal.sessionId,
    );
    await limit(
      req,
      "guest_write_ip",
      Number(process.env.GUEST_WRITE_IP_RATE_LIMIT ?? 100),
    );
    const result = await saveRsvp(
      principal,
      (await context.params).publicId,
      await input(req, rsvpInput),
      req.headers.get("idempotency-key") ?? "",
    );
    return reply(result.body, id, result.status);
  })(request);
