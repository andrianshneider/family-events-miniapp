import { z } from "zod";
import { endpoint, reply } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { organizerEvent } from "@/server/services/events";
export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async (_request, id) => {
    const principal = await organizer();
    const { eventId } = await context.params;
    return reply(await organizerEvent(principal, z.uuid().parse(eventId)), id);
  })(request);
