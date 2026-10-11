import { z } from "zod";
import { endpoint, reply, input } from "@/server/api";
import { organizer, ORG_COOKIE } from "@/server/auth/sessions";
import { organizerEvent, updateEvent } from "@/server/services/events";
import { requireMutation } from "@/server/auth/csrf";
import { eventUpdateInput } from "@/lib/validation";
export const PATCH = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async (request, id) => {
    const principal = await organizer();
    await requireMutation(request, ORG_COOKIE);
    const eventId = z.uuid().parse((await context.params).eventId);
    const data = await input(request, eventUpdateInput);
    const result = await updateEvent(
      principal,
      eventId,
      data,
      request.headers.get("idempotency-key") ?? "",
    );
    return reply(result.body, id, result.status);
  })(request);
export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  endpoint(async (_request, id) => {
    const principal = await organizer();
    const { eventId } = await context.params;
    return reply(await organizerEvent(principal, z.uuid().parse(eventId)), id);
  })(request);
