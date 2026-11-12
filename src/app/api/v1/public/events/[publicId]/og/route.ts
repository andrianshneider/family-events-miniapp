import { endpoint } from "@/server/api";
import { limit } from "@/server/auth/rate-limit";
import { validPublicId } from "@/server/services/public-events";
import { eventOg } from "@/server/storage/event-og";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req) => {
    const publicId = validPublicId((await context.params).publicId);
    await limit(
      req,
      "public",
      Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
    );
    return new Response(new Uint8Array(await eventOg(publicId)), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })(request);
