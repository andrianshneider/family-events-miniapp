import { z } from "zod";
import { redirect, notFound } from "next/navigation";
import { organizer } from "@/server/auth/sessions";
import { organizerEvent } from "@/server/services/events";
import { AppError } from "@/server/errors";
import { CreateEventScreen } from "@/components/create-event-screen";
export const dynamic = "force-dynamic";
export default async function EditEvent({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const parsed = z.uuid().safeParse((await params).eventId);
  if (!parsed.success) notFound();
  let principal, event;
  try {
    principal = await organizer();
    event = await organizerEvent(principal, parsed.data);
  } catch (error) {
    if (error instanceof AppError && error.status === 401)
      redirect(
        `/login?returnTo=${encodeURIComponent(`/events/${parsed.data}/edit`)}`,
      );
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return (
    <CreateEventScreen
      key={`${principal.userId}:${event.id}:${event.version}`}
      userId={principal.userId}
      displayName={event.displayName}
      editing={{
        id: event.id,
        version: event.version,
        latitude: event.latitude,
        longitude: event.longitude,
        fields: {
          title: event.title,
          eventType: event.eventType,
          eventDate: event.eventDate,
          startTime: event.startTime ?? "",
          endTime: event.endTime ?? "",
          timezone: event.timezone,
          venueName: event.venueName ?? "",
          address: event.address ?? "",
          directions: event.directions ?? "",
          description: event.description ?? "",
          dressCode: event.dressCode ?? "",
          coverAssetId: event.coverAssetId ?? "",
        },
      }}
    />
  );
}
