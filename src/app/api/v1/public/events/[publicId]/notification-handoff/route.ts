import { endpoint, reply, input } from "@/server/api";
import { guestNotificationMutation } from "@/server/services/guest-notification-api";
import { z } from "zod";
import { beginGuestHandoff } from "@/server/services/guest-notifications";
export const POST = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    const p = await guestNotificationMutation(req);
    const body = await input(
      req,
      z.object({ restart: z.boolean().optional() }).strict(),
    );
    return reply(
      await beginGuestHandoff(
        p,
        (await context.params).publicId,
        body.restart === true,
      ),
      id,
    );
  })(request);
