import { z } from "zod";
import { endpoint, reply, input } from "@/server/api";
import { wishlistMutation } from "@/server/services/wishlist-api";
import { confirmSignedPermission } from "@/server/services/organizer-notifications";
export const POST = (
  request: Request,
  c: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async (req, id) => {
    const p = await wishlistMutation(req),
      data = await input(
        req,
        z.object({ initData: z.string().min(1).max(16384) }).strict(),
      );
    return reply(
      await confirmSignedPermission(p, (await c.params).eventId, data.initData),
      id,
    );
  })(request);
