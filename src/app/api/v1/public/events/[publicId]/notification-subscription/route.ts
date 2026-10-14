import { publicWishlistLimit } from "@/server/services/wishlist-api";
import { endpoint, reply, input } from "@/server/api";
import { guest } from "@/server/auth/sessions";
import { guestNotificationMutation } from "@/server/services/guest-notification-api";
import { z } from "zod";
import {
  guestNotificationSettings,
  setGuestSubscription,
} from "@/server/services/guest-notifications";
export const GET = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    await publicWishlistLimit(req);
    return reply(
      await guestNotificationSettings(
        await guest(),
        (await context.params).publicId,
      ),
      id,
    );
  })(request);
export const PUT = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    const p = await guestNotificationMutation(req);
    const body = await input(req, z.object({ enabled: z.boolean() }).strict());
    return reply(
      await setGuestSubscription(
        p,
        (await context.params).publicId,
        body.enabled,
      ),
      id,
    );
  })(request);
