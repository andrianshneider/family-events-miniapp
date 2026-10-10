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
      await db()`SELECT storage_path,mime_type FROM app.media_assets WHERE id=${assetId} AND owner_user_id=${principal.userId} AND state='ready'`;
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
