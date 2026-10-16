import { resetAnalytics, analyticsCookie } from "@/server/analytics/identity";
import { principals } from "@/server/analytics/context";
import { visitor } from "@/server/analytics/journal";
import { cookies } from "next/headers";
import { endpoint, input, reply } from "@/server/api";
import { z } from "zod";
import { requireOrigin } from "@/server/auth/csrf";
import { limit } from "@/server/auth/rate-limit";
import { enabled } from "@/server/analytics/journal";
import { context, locator } from "@/server/analytics/context";
import { transaction } from "@/server/db/client";
export const POST = endpoint(async (req, id) => {
  requireOrigin(req);
  await limit(req, "analytics_context", 180);
  const data = await input(
    req,
    z
      .object({
        locator: locator.optional(),
        platform: z.enum(["web", "telegram", "pwa"]).optional(),
      })
      .strict(),
    1024,
  );
  if (!enabled()) return reply({ enabled: false, consent: false }, id);
  const reset = await transaction(async (tx) => {
    const v = await visitor(tx);
    if (v?.had_organizer_session && !(await principals()).userId)
      return resetAnalytics(tx);
  });
  if (reset) {
    const response = reply({ enabled: true, consent: true, reset: true }, id);
    await analyticsCookie(response, reset, true);
    return response;
  }
  const c = await transaction(async (tx) => {
    if (data.platform) {
      const v = await visitor(tx);
      if (v)
        await tx`UPDATE app.analytics_visitors SET last_platform=${data.platform} WHERE id=${v.id}`;
    }
    return context(tx, data.locator);
  });
  const choice = (await cookies()).get("__Host-fe_analytics_choice")?.value;
  return reply(
    c
      ? {
          enabled: true,
          consent: true,
          distinctId: c.distinctId,
          identified: c.identified,
          eventId: c.eventId,
          actorRelation: c.relation,
          isAuthenticated: c.isAuthenticated,
        }
      : { enabled: true, consent: false, choice },
    id,
  );
});
