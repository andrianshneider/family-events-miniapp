import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { organizer } from "@/server/auth/sessions";
import { notificationSettings } from "@/server/services/organizer-notifications";
import { AppError } from "@/server/errors";
import { OrganizerNotificationsScreen } from "@/components/organizer-notifications-screen";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  let initial = null;
  try {
    initial = await notificationSettings(await organizer(), eventId);
  } catch (e) {
    if (e instanceof AppError && e.status === 401)
      redirect(
        "/login?returnTo=" +
          encodeURIComponent(`/events/${eventId}/notifications`),
      );
    if (e instanceof AppError && e.status === 404) notFound();
  }
  return <OrganizerNotificationsScreen eventId={eventId} initial={initial} />;
}
