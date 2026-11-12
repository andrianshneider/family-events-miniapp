import "server-only";
import sharp from "sharp";
import type { OrganizerPrincipal } from "@/types/principal";
import { db } from "../db/client";
import { AppError } from "../errors";
import { validPublicId } from "../services/public-events";
import { storage, mediaBucket } from "./client";
import { thumbnailPath } from "./thumbnails";
export async function giftImage(
  key: string,
  giftId: string,
  principal?: OrganizerPrincipal,
) {
  if (!principal) validPublicId(key);
  const [m] =
    await db()`SELECT m.storage_path FROM app.media_assets m JOIN app.gifts g ON g.image_asset_id=m.id JOIN app.wishlists w ON w.id=g.wishlist_id JOIN app.events e ON e.id=w.event_id WHERE g.id=${giftId} AND g.deleted_at IS NULL AND e.deleted_at IS NULL AND m.state='ready' AND m.owner_user_id=e.organizer_id AND ((${principal?.userId ?? null}::uuid IS NOT NULL AND e.id=${principal ? key : null}::uuid AND e.organizer_id=${principal?.userId ?? null}::uuid) OR (${principal?.userId ?? null}::uuid IS NULL AND e.public_id=${principal ? null : key}))`;
  if (!m)
    throw new AppError(
      404,
      "GIFT_UNAVAILABLE",
      "Изображение подарка недоступно.",
    );
  const bucket = storage().from(mediaBucket());
  let result = await bucket.download(thumbnailPath(m.storage_path));
  if (result.error || !result.data)
    result = await bucket.download(m.storage_path);
  if (result.error || !result.data)
    throw new AppError(
      503,
      "IMAGE_UNAVAILABLE",
      "Не удалось загрузить изображение. Повторите попытку.",
    );
  const bytes = await sharp(Buffer.from(await result.data.arrayBuffer()), {
    limitInputPixels: 20000000,
  })
    .resize(640, 640, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
