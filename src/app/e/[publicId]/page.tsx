import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicPageEvent } from "@/server/services/public-page";
import { canonicalEventUrl } from "@/server/services/public-events";
import { readWishlist } from "@/server/services/wishlists";
import { AppError } from "@/server/errors";
import { eventWhen } from "@/lib/invitation";
import { PublicEventScreen } from "@/components/public-event-screen";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  try {
    const event = await publicPageEvent(publicId);
    const url = canonicalEventUrl(publicId);
    const image = new URL(
      `/api/v1/public/events/${publicId}/og?v=${event.version}`,
      url,
    ).toString();
    return {
      title: event.title,
      description: eventWhen(event),
      robots: { index: false, follow: false },
      alternates: { canonical: url },
      openGraph: {
        type: "website",
        url,
        title: event.title,
        description: eventWhen(event),
        images: [
          {
            url: image,
            width: 1200,
            height: 630,
            alt: `Приглашение: ${event.title}`,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: event.title,
        description: eventWhen(event),
        images: [image],
      },
    };
  } catch (error) {
    if (error instanceof AppError && error.status === 404)
      return {
        title: "Это мероприятие недоступно",
        robots: { index: false, follow: false },
      };
    throw error;
  }
}
export default async function PublicPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  let event;
  try {
    event = await publicPageEvent((await params).publicId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  let wishlist = null;
  try { wishlist = await readWishlist(event.publicId, {limit:3}); } catch(error) { if(error instanceof AppError && error.status===404) notFound(); }
  return (
    <PublicEventScreen
      key={`${event.publicId}:${event.version}`}
      initialEvent={event}
      initialWishlist={wishlist}
    />
  );
}
