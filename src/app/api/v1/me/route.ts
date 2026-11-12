import { endpoint, reply } from "@/server/api";
import { organizerProfile } from "@/server/auth/sessions";
export const GET = endpoint(async (_request, id) =>
  reply((await organizerProfile()).profile, id),
);
