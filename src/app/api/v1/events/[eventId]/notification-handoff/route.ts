import { endpoint, reply, input } from "@/server/api";
import { wishlistMutation } from "@/server/services/wishlist-api";
import {
  handoffInput,
  beginNotificationHandoff,
} from "@/server/services/organizer-notifications";
export const POST = (
  request: Request,
  c: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async (req, id) => {
    const p = await wishlistMutation(req),
      data = await input(req, handoffInput);
    return reply(
      await beginNotificationHandoff(p, (await c.params).eventId, data.mode),
      id,
      201,
    );
  })(request);
