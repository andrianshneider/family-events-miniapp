import { cookies } from "next/headers";
import { endpoint, reply } from "@/server/api";
import {
  organizer,
  guest,
  ORG_COOKIE,
  GUEST_COOKIE,
} from "@/server/auth/sessions";
import { csrf } from "@/server/auth/crypto";
export const GET = endpoint(async (request, id) => {
  const guestContext =
    new URL(request.url).searchParams.get("context") === "guest";
  await (guestContext ? guest() : organizer());
  const raw = (await cookies()).get(
    guestContext ? GUEST_COOKIE : ORG_COOKIE,
  )!.value;
  return reply({ csrfToken: csrf(raw) }, id);
});
