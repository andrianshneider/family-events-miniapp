import { z } from "zod";
import { endpoint } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
import { unavailable } from "@/server/errors";
import { storage, mediaBucket } from "@/server/storage/client";
export const GET = (
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) =>
  endpoint(async () => {
    const principal = await organizer();
    const assetId = z.uuid().parse((await context.params).assetId);
    const [asset] =
      await db()`SELECT m.storage_path,m.mime_type FROM app.media_assets m WHERE m.id=${assetId} AND m.owner_user_id=${principal.userId} AND m.state='ready'
      AND ((NOT EXISTS(SELECT 1 FROM app.events e WHERE e.cover_asset_id=m.id) AND NOT EXISTS(SELECT 1 FROM app.gifts g WHERE g.image_asset_id=m.id))
           OR EXISTS(SELECT 1 FROM app.events e WHERE e.cover_asset_id=m.id AND e.deleted_at IS NULL)
           OR EXISTS(SELECT 1 FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id JOIN app.events e ON e.id=w.event_id WHERE g.image_asset_id=m.id AND g.deleted_at IS NULL AND e.deleted_at IS NULL))`;
    if (!asset) throw unavailable();
    const { data, error } = await storage()
      .from(mediaBucket())
      .createSignedUrl(asset.storage_path, 60);
    if (error || !data) throw unavailable();
    return new Response(null, {
      status: 307,
      headers: {
        Location: data.signedUrl,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })(request);
