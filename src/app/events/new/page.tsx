import { organizer } from "@/server/auth/sessions";
import { AppError } from "@/server/errors";
import { redirect } from "next/navigation";
import { CreateEventScreen } from "@/components/create-event-screen";
import { db } from "@/server/db/client";
export const dynamic = "force-dynamic";
export default async function NewEvent() {
  let principal;
  try {
    principal = await organizer();
  } catch (error) {
    if (error instanceof AppError && error.status === 401)
      redirect("/login?returnTo=/events/new");
    throw error;
  }
  const [user] =
    await db()`SELECT display_name FROM app.users WHERE id=${principal.userId}`;
  return (
    <CreateEventScreen
      userId={principal.userId}
      displayName={user.display_name}
    />
  );
}
