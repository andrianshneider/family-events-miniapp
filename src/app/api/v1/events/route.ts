import { endpoint, input, reply } from "@/server/api";
import {
  organizer,
  organizerProfile,
  ORG_COOKIE,
} from "@/server/auth/sessions";
import { requireMutation } from "@/server/auth/csrf";
import { eventInput } from "@/lib/validation";
import { createEvent } from "@/server/services/events";
import { eventList } from "@/server/services/event-list";
import { z } from "zod";
import { AppError } from "@/server/errors";
const cursorSchema = z.object({ date: z.iso.date(), id: z.uuid() }).strict();
export const POST = endpoint(async (request, id) => {
  const principal = await organizer();
  await requireMutation(request, ORG_COOKIE);
  const data = await input(request, eventInput);
  const result = await createEvent(
    principal,
    data,
    request.headers.get("idempotency-key") ?? "",
  );
  return reply(result.body, id, result.status);
});
export const GET = endpoint(async (request, id) => {
  const { principal, profile } = await organizerProfile();
  const rawCursor = new URL(request.url).searchParams.get("cursor");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (rawCursor !== null) {
    try {
      if (rawCursor.length > 256 || !/^[\w-]+$/.test(rawCursor)) throw Error();
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new AppError(422, "INVALID_CURSOR", "Обновите список событий.");
    }
  }
  return reply({ ...(await eventList(principal, cursor)), profile }, id);
});
