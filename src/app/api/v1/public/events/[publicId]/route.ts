import { endpoint, reply } from "@/server/api";
import { limit } from "@/server/auth/rate-limit";
import { publicEvent, validPublicId } from "@/server/services/public-events";
export const GET = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    const publicId = validPublicId((await context.params).publicId);
    await limit(
      req,
      "public",
      Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
    );
    return reply(await publicEvent(publicId), id);
  })(request);
