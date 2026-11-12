import { z } from "zod";
import { endpoint } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
import { unavailable } from "@/server/errors";
import { storage, mediaBucket } from "@/server/storage/client";
export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async () => {
    const principal = await organizer();
    const { eventId } = await context.params;
    const validId = z.uuid().parse(eventId);
    const [asset] =
      await db()`SELECT m.storage_path,m.mime_type FROM app.events e JOIN app.media_assets m ON m.id=e.cover_asset_id WHERE e.id=${validId} AND e.organizer_id=${principal.userId} AND e.deleted_at IS NULL AND m.owner_user_id=${principal.userId} AND m.state='ready'`;
    if (!asset) throw unavailable();
    const { data, error } = await storage()
      .from(mediaBucket())
      .createSignedUrl(asset.storage_path, 60);
    if (!data || error) throw unavailable();
    // Deliver directly from private Storage to support images larger than serverless response limits.
    return new Response(null, {
      status: 307,
      headers: {
        Location: data.signedUrl,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })(request);
