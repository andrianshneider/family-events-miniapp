import { endpoint, input, reply } from "@/server/api";
import { requireOrigin } from "@/server/auth/csrf";
import { limit } from "@/server/auth/rate-limit";
import { transaction } from "@/server/db/client";
import { collect } from "@/server/analytics/context";
import { enabled } from "@/server/analytics/journal";
import { clientInput } from "@/lib/analytics/contract";
export const POST = endpoint(async (req, id) => {
  requireOrigin(req);
  await limit(req, "analytics_collect", 180);
  const data = await input(req, clientInput, 4096);
  if (enabled()) await transaction((tx) => collect(tx, data));
  return reply({ accepted: true }, id, 202);
});
