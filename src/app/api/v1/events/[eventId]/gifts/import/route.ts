import { z } from "zod";
import { endpoint, input, reply } from "@/server/api";
import { organizer, ORG_COOKIE } from "@/server/auth/sessions";
import { requireMutation } from "@/server/auth/csrf";
import { limit } from "@/server/auth/rate-limit";
import { db } from "@/server/db/client";
import { unavailable } from "@/server/errors";
import { importProduct } from "@/server/product/import";
export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async (req, id) => {
    const principal = await organizer();
    await requireMutation(req, ORG_COOKIE);
    await limit(req, "product_import", 6, principal.userId);
    const eventId = z.uuid().parse((await context.params).eventId);
    const [event] =
      await db()`SELECT id FROM app.events WHERE id=${eventId} AND organizer_id=${principal.userId} AND deleted_at IS NULL`;
    if (!event) throw unavailable();
    const { url } = await input(
      req,
      z.object({ url: z.url().max(2048) }).strict(),
    );
    return reply(await importProduct(url), id);
  })(request);
