import { endpoint, reply } from "@/server/api";
import { guestContext } from "@/server/services/rsvps";
import { limit } from "@/server/auth/rate-limit";
export const GET = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    await limit(
      req,
      "public",
      Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
    );
    return reply(await guestContext((await context.params).publicId), id);
  })(request);
