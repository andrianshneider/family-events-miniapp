import { endpoint, reply } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { db } from "@/server/db/client";
export const GET = endpoint(async (_request, id) => {
  const p = await organizer();
  const [user] =
    await db()`SELECT id,display_name,avatar_url FROM app.users WHERE id=${p.userId}`;
  return reply(
    { id: user.id, displayName: user.display_name, avatarUrl: user.avatar_url },
    id,
  );
});
