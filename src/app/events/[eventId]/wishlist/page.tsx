import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { organizer } from "@/server/auth/sessions";
import { readWishlist } from "@/server/services/wishlists";
import { AppError } from "@/server/errors";
import { WishlistScreen } from "@/components/wishlist-screen";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const parsed = z.uuid().safeParse((await params).eventId);
  if (!parsed.success) notFound();
  const backToEvents = (await searchParams).from === "events";
  let initial = null;
  try {
    initial = await readWishlist(parsed.data, {}, await organizer());
  } catch (e) {
    if (e instanceof AppError && e.status === 401)
      redirect(
        "/login?returnTo=" +
          encodeURIComponent(
            `/events/${parsed.data}/wishlist${backToEvents ? "?from=events" : ""}`,
          ),
      );
    if (e instanceof AppError && e.status === 404) notFound();
  }
  return (
    <WishlistScreen
      key={parsed.data}
      eventKey={parsed.data}
      owner
      initial={initial}
      backToEvents={backToEvents}
    />
  );
}
