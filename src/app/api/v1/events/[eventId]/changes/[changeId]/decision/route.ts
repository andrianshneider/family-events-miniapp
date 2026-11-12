import { endpoint, input, reply } from "@/server/api";
import { wishlistMutation } from "@/server/services/wishlist-api";
import { decideChange } from "@/server/notifications/guest";
import { z } from "zod";
export const POST = (
  request: Request,
  context: { params: Promise<{ eventId: string; changeId: string }> },
) =>
  endpoint(async (req, id) => {
    const p = await wishlistMutation(req);
    const params = z
      .object({ eventId: z.uuid(), changeId: z.uuid() })
      .parse(await context.params);
    const body = await input(
      req,
      z.object({ decision: z.enum(["send", "skip"]) }).strict(),
    );
    const result = await decideChange(
      p,
      params.eventId,
      params.changeId,
      body.decision,
      req.headers.get("idempotency-key") ?? "",
    );
    return reply(result.body, id, result.status);
  })(request);
