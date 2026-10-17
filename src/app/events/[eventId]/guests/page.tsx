import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { organizer } from "@/server/auth/sessions";
import { eventGuests } from "@/server/services/guests";
import { AppError } from "@/server/errors";
import { GuestListScreen } from "@/components/guest-list-screen";
export const dynamic = "force-dynamic";
export default async function GuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const parsed = z.uuid().safeParse((await params).eventId);
  if (!parsed.success) notFound();
  const status = z
    .enum(["yes", "no", "maybe"])
    .optional()
    .safeParse((await searchParams).status);
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
            `/events/${parsed.data}/guests${status.data ? "?status=" + status.data : ""}`,
          ),
      );
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return (
    <GuestListScreen
      key={`${parsed.data}:${status.data ?? "all"}`}
      initial={initial}
    />
  );
}
