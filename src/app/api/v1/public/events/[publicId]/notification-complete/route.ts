import { organizer } from "@/server/auth/sessions";
import { AppError } from "@/server/errors";
import { endpoint, reply, input } from "@/server/api";
import { guestNotificationMutation } from "@/server/services/guest-notification-api";
import {
  completeInput,
  completeGuestHandoff,
} from "@/server/services/guest-notifications";
import { sessionCookie, GUEST_COOKIE, GUEST_TTL } from "@/server/auth/sessions";
export const POST = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    const p = await guestNotificationMutation(req);
    let userId: string | null = null;
    try {
      userId = (await organizer()).userId;
    } catch (e) {
      if (!(e instanceof AppError && e.status === 401)) throw e;
    }
    const result = await completeGuestHandoff(
      p,
      (await context.params).publicId,
      await input(req, completeInput),
      userId,
    );
    const response = reply({ enabled: true }, id);
    sessionCookie(response, GUEST_COOKIE, result.raw, GUEST_TTL);
    return response;
  })(request);
