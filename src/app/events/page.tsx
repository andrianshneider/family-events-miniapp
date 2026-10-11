import { organizerProfile } from "@/server/auth/sessions";
import { eventList } from "@/server/services/event-list";
import { measured } from "@/server/performance";
import { redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import { EventsScreen } from "@/components/events-screen";
export const dynamic = "force-dynamic";
export default async function Events() {
  const { value: initial } = await measured(async () => {
    let session;
    try {
      session = await organizerProfile();
    } catch (e) {
      if (e instanceof AppError && e.status === 401) redirect("/login");
      throw e;
    }
    return {
      ...(await eventList(session.principal)),
      profile: session.profile,
    };
  });
  return <EventsScreen initial={initial} />;
}
