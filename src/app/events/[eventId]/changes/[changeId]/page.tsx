import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { organizer } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { EventChangeScreen } from "@/components/event-change-screen";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ eventId: string; changeId: string }>;
}) {
  const { eventId, changeId } = z
    .object({ eventId: z.uuid(), changeId: z.uuid() })
    .parse(await params);
  let p;
  try {
    p = await organizer();
  } catch (e) {
    if (e instanceof AppError && e.status === 401)
      redirect("/login?returnTo=" + encodeURIComponent(`/events/${eventId}`));
    throw e;
  }
  const [c] =
    await db()`SELECT c.changes,c.notify_decision,e.title FROM app.event_changes c JOIN app.events e ON e.id=c.event_id WHERE c.id=${changeId} AND e.id=${eventId} AND e.organizer_id=${p.userId} AND e.deleted_at IS NULL`;
  if (!c) notFound();
  return (
    <EventChangeScreen
      eventId={eventId}
      changeId={changeId}
      title={c.title}
      changes={c.changes}
      decision={c.notify_decision}
    />
  );
}
