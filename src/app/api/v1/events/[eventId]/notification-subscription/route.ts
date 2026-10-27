import { endpoint, reply, input } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { wishlistMutation } from "@/server/services/wishlist-api";
import {
  subscriptionInput,
  notificationSettings,
  setNotificationSubscription,
} from "@/server/services/organizer-notifications";
type Context = { params: Promise<{ eventId: string }> };
export const GET = (request: Request, c: Context) =>
  endpoint(async (req, id) =>
    reply(
      await notificationSettings(await organizer(), (await c.params).eventId),
      id,
    ),
  )(request);
export const PUT = (request: Request, c: Context) =>
  endpoint(async (req, id) => {
    const p = await wishlistMutation(req),
      data = await input(req, subscriptionInput),
      result = await setNotificationSubscription(
        p,
        (await c.params).eventId,
        data.enabled,
        req.headers.get("idempotency-key") ?? "",
      );
    return reply(result.body, id, result.status);
  })(request);
