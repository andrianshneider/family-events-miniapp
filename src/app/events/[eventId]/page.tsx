import { z } from "zod";
import { redirect, notFound } from "next/navigation";
import { organizer } from "@/server/auth/sessions";
import { organizerEvent } from "@/server/services/events";
import { AppError } from "@/server/errors";
import { EventScreen } from "@/components/event-screen";
export const dynamic = "force-dynamic";
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const parsed = z.uuid().safeParse((await params).eventId);
  if (!parsed.success) notFound();
  let event;
  try {
    event = await organizerEvent(await organizer(), parsed.data);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return (
    <EventScreen
      key={event.id}
      initialEvent={event}
      created={(await searchParams).created === "1"}
    />
  );
}
