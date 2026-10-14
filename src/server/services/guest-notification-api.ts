import "server-only";
import { guest, GUEST_COOKIE } from "../auth/sessions";
import { requireMutation } from "../auth/csrf";
import { limit } from "../auth/rate-limit";
export async function guestNotificationMutation(req: Request) {
  const p = await guest();
  await requireMutation(req, GUEST_COOKIE);
  await limit(
    req,
    "guest_write_session",
    Number(process.env.GUEST_WRITE_SESSION_RATE_LIMIT ?? 30),
    p.sessionId,
  );
  await limit(
    req,
    "guest_write_ip",
    Number(process.env.GUEST_WRITE_IP_RATE_LIMIT ?? 100),
  );
  return p;
}
