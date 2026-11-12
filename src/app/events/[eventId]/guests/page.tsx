import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { organizer } from "@/server/auth/sessions";
import { eventGuests } from "@/server/services/guests";
import { AppError } from "@/server/errors";
import { guestListPath } from "@/lib/rsvp";
import { GuestListScreen } from "@/components/guest-list-screen";
export const dynamic = "force-dynamic";
export default async function GuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ status?: string; from?: string | string[] }>;
}) {
  const parsed = z.uuid().safeParse((await params).eventId);
  if (!parsed.success) notFound();
  const query = await searchParams;
  const backToEvents = query.from === "events";
  const status = z
    .enum(["yes", "no", "maybe"])
    .optional()
    .safeParse(query.status);
  if (!status.success) notFound();
  let initial;
  try {
    initial = await eventGuests(await organizer(), parsed.data, {
      status: status.data ?? null,
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 401)
      redirect(
        "/login?returnTo=" +
          encodeURIComponent(
            guestListPath(parsed.data, status.data ?? null, backToEvents),
          ),
      );
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return (
    <GuestListScreen
      key={`${parsed.data}:${status.data ?? "all"}`}
      initial={initial}
      backToEvents={backToEvents}
    />
  );
}
