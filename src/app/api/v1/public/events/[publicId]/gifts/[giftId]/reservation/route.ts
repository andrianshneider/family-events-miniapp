import { reserveInput, cancelInput } from "@/lib/reservation-validation";
import { endpoint, reply, input } from "@/server/api";
import { guest, GUEST_COOKIE } from "@/server/auth/sessions";
import { requireMutation } from "@/server/auth/csrf";
import { limit } from "@/server/auth/rate-limit";
import { mutateReservation } from "@/server/services/reservations";
type Context = { params: Promise<{ publicId: string; giftId: string }> };
const mutation =
  (method: "POST" | "DELETE") => (request: Request, context: Context) =>
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
      const { publicId, giftId } = await context.params;
      const data =
        method === "POST"
          ? await input(req, reserveInput)
          : await input(req, cancelInput);
      const result = await mutateReservation(
        principal,
        publicId,
        giftId,
        method,
        data,
        req.headers.get("idempotency-key") ?? "",
      );
      return reply(result.body, id, result.status);
    })(request);
export const POST = mutation("POST");
export const DELETE = mutation("DELETE");
