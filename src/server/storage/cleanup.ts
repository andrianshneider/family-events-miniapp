import "server-only";
import { db } from "../db/client";
import { storage, mediaBucket } from "./client";
export async function cleanupMedia() {
  const assets =
    await db()`SELECT m.id,m.storage_path FROM app.media_assets m WHERE m.created_at<now()-interval '24 hours' AND m.state IN ('pending','ready','deleted') AND NOT EXISTS(SELECT FROM app.events e WHERE e.cover_asset_id=m.id AND e.deleted_at IS NULL) AND NOT EXISTS(SELECT FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id JOIN app.events e ON e.id=w.event_id WHERE g.image_asset_id=m.id AND g.deleted_at IS NULL AND e.deleted_at IS NULL) ORDER BY m.created_at LIMIT 100`;
  let removed = 0;
  for (const asset of assets) {
    // Lock before removal to serialize with attachment guard and completeUpload.
    await db().begin(async (tx) => {
      const [row] =
        await tx`SELECT id FROM app.media_assets WHERE id=${asset.id} FOR UPDATE`;
      if (!row) return;
      const [attached] =
        await tx`SELECT EXISTS(SELECT FROM app.events WHERE cover_asset_id=${asset.id} AND deleted_at IS NULL) OR EXISTS(SELECT FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id JOIN app.events e ON e.id=w.event_id WHERE g.image_asset_id=${asset.id} AND g.deleted_at IS NULL AND e.deleted_at IS NULL) AS attached`;
      if (attached.attached) return;
      await tx`UPDATE app.media_assets SET state='deleted',deleted_at=coalesce(deleted_at,now()) WHERE id=${asset.id}`;
      const { error } = await storage()
        .from(mediaBucket())
        .remove([asset.storage_path]);
      if (error) throw new Error("Storage cleanup failed");
      removed++;
    });
  }
  return { removed };
}
