import { z } from "zod";
import { endpoint, reply } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { invitation } from "@/server/services/public-events";
export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async (_req, id) =>
    reply(
      await invitation(
        await organizer(),
        z.uuid().parse((await context.params).eventId),
      ),
      id,
    ),
  )(request);
