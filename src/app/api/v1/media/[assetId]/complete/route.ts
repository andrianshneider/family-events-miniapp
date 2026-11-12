import { z } from "zod";
import { endpoint, reply } from "@/server/api";
import { organizer, ORG_COOKIE } from "@/server/auth/sessions";
import { requireMutation } from "@/server/auth/csrf";
import { completeUpload } from "@/server/storage/media";
export const POST = async (
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) =>
  endpoint(async (req, id) => {
    await requireMutation(req, ORG_COOKIE);
    const p = await organizer();
    const { assetId } = await context.params;
    return reply(await completeUpload(p, z.uuid().parse(assetId)), id);
  })(request);
