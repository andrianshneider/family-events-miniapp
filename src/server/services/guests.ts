import "server-only";
import { z } from "zod";
import type { Guests, RsvpStatus } from "@/lib/rsvp";
import type { OrganizerPrincipal } from "@/types/principal";
import { transaction } from "../db/client";
import { AppError, unavailable } from "../errors";
import { rsvpDto, summaryDto } from "./rsvps";
const cursorSchema = z
  .object({
    eventId: z.uuid(),
    status: z.enum(["yes", "no", "maybe"]).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();
export function guestQuery(url: URL) {
  const parsed = z
    .object({
      status: z.enum(["yes", "no", "maybe"]).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().max(512).optional(),
    })
    .safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success)
    throw new AppError(
      422,
      "INVALID_GUEST_QUERY",
      "Проверьте фильтр списка гостей.",
    );
  return {
    status: parsed.data.status ?? null,
    limit: parsed.data.limit,
    cursor: parsed.data.cursor,
  };
}
export async function eventGuests(
  principal: OrganizerPrincipal,
  eventId: string,
  options: { status?: RsvpStatus | null; limit?: number; cursor?: string } = {},
): Promise<Guests> {
  const status = options.status ?? null,
    limit = options.limit ?? 20;
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (options.cursor) {
    try {
      if (!/^[\w-]+$/.test(options.cursor) || options.cursor.length > 512)
        throw Error();
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(options.cursor, "base64url").toString()),
      );
      if (cursor.eventId !== eventId || cursor.status !== status) throw Error();
    } catch {
      throw new AppError(422, "INVALID_CURSOR", "Обновите список гостей.");
    }
  }
  return transaction(async (tx) => {
    const [event] =
      await tx`SELECT id,title,event_date::text,version FROM app.events WHERE id=${eventId} AND organizer_id=${principal.userId} AND deleted_at IS NULL FOR SHARE`;
    if (!event) throw unavailable();
    const [aggregate] =
      await tx`SELECT count(*) FILTER(WHERE status='yes')::int AS yes,count(*) FILTER(WHERE status='no')::int AS no,count(*) FILTER(WHERE status='maybe')::int AS maybe,coalesce(sum(adults_count) FILTER(WHERE status='yes'),0)::int AS adults,coalesce(sum(children_count) FILTER(WHERE status='yes'),0)::int AS children,max(updated_at)::text AS last_update,coalesce(sum(version),0)::bigint AS versions FROM app.rsvps WHERE event_id=${eventId}`;
    const rows =
      await tx`SELECT id,guest_name,status,adults_count,children_count,comment,version,updated_at,created_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM app.rsvps WHERE event_id=${eventId} AND (${status}::text IS NULL OR status=${status}) AND (${cursor?.createdAt ?? null}::timestamptz IS NULL OR (created_at,id)<(${cursor?.createdAt ?? null}::timestamptz,${cursor?.id ?? null}::uuid)) ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit),
      last = page.at(-1);
    return {
      revision: `${event.version}:${aggregate.yes + aggregate.no + aggregate.maybe}:${aggregate.versions}:${aggregate.last_update ?? "empty"}`,
      event: { id: event.id, title: event.title, eventDate: event.event_date },
      summary: summaryDto(aggregate),
      guests: page.map(rsvpDto),
      filter: status,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                eventId,
                status,
                createdAt: last.cursor_created_at,
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
  });
}
