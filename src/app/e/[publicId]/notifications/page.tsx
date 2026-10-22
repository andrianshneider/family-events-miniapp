import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";
import { GuestNotificationsScreen } from "@/components/guest-notifications-screen";
import { publicEvent } from "@/server/services/public-events";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Уведомления в Telegram — Family Events",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  try {
    await publicEvent(publicId);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  return <GuestNotificationsScreen publicId={publicId} />;
}
