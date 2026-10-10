import { endpoint } from "@/server/api";
import { eventCover } from "@/server/storage/media";
import { limit } from "@/server/auth/rate-limit";
export const GET = async (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req) => {
    await limit(
      req,
      "public",
      Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
    );
    const { publicId } = await context.params;
    return new Response(await eventCover(publicId), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })(request);
