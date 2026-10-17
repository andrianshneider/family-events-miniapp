import { endpoint, reply, input } from "@/server/api";
import { guestNotificationMutation } from "@/server/services/guest-notification-api";
import { z } from "zod";
import { verifyGuestMini } from "@/server/services/guest-notifications";
export const POST = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    const p = await guestNotificationMutation(req);
    const body = await input(
      req,
      z.object({ initData: z.string().min(1).max(16384) }).strict(),
    );
    return reply(
      await verifyGuestMini(p, (await context.params).publicId, body.initData),
      id,
    );
  })(request);
