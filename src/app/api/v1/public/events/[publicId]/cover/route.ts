import sharp from "sharp";
import { endpoint } from "@/server/api";
import { eventCover } from "@/server/storage/media";
import { validPublicId } from "@/server/services/public-events";
import { limit } from "@/server/auth/rate-limit";
export const GET = async (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req) => {
    const { publicId } = await context.params;
    validPublicId(publicId);
    await limit(
      req,
      "public",
      Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
    );
    const image = await eventCover(publicId);
    const bytes = await sharp(Buffer.from(await image.arrayBuffer()), {
      limitInputPixels: 20000000,
    })
      .resize(1600, 960, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })(request);
