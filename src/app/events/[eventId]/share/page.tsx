import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { organizer } from "@/server/auth/sessions";
import { invitation } from "@/server/services/public-events";
import { AppError } from "@/server/errors";
import { ShareEventScreen } from "@/components/share-event-screen";
export const dynamic = "force-dynamic";
export default async function SharePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const parsed = z.uuid().safeParse((await params).eventId);
  if (!parsed.success) notFound();
  let data;
  try {
    data = await invitation(await organizer(), parsed.data);
  } catch (error) {
    if (error instanceof AppError && error.status === 401)
      redirect(
        "/login?returnTo=" + encodeURIComponent(`/events/${parsed.data}/share`),
      );
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return (
    <ShareEventScreen
      key={`${parsed.data}:${data.event.version}`}
      eventId={parsed.data}
      initial={data}
    />
  );
}
