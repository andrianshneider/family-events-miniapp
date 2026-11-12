import { publicWishlistLimit } from "@/server/services/wishlist-api";
import { endpoint, reply } from "@/server/api";
import { guest } from "@/server/auth/sessions";
import { z } from "zod";
import { guestHandoffStatus } from "@/server/services/guest-notifications";
export const GET = (
  request: Request,
  context: { params: Promise<{ publicId: string; handoffId: string }> },
) =>
  endpoint(async (req, id) => {
    await publicWishlistLimit(req);
    const params = await context.params;
    return reply(
      await guestHandoffStatus(
        await guest(),
        params.publicId,
        z.uuid().parse(params.handoffId),
      ),
      id,
    );
  })(request);
