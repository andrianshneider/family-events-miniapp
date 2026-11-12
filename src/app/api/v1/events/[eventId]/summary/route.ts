import { z } from "zod";
import { endpoint, reply } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { eventGuests } from "@/server/services/guests";
export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async (_req, id) =>
    reply(
      (
        await eventGuests(
          await organizer(),
          z.uuid().parse((await context.params).eventId),
          { limit: 1 },
        )
      ).summary,
      id,
    ),
  )(request);
