import { drain, configured } from "@/server/analytics/exporter";
import { log } from "@/server/log";
import { z } from "zod";
import { endpoint, reply, input } from "@/server/api";
import { processUpdates } from "@/server/telegram/updates";
import { deliver } from "@/server/notifications/worker";
import { schedulerCredential } from "@/server/notifications/scheduler-auth";
import { transaction } from "@/server/db/client";
import { idempotent } from "@/server/db/idempotency";
export const maxDuration = 60;
export const POST = endpoint(async (req, id) => {
  const started = Date.now();
  const credential = schedulerCredential(req);
  await input(req, z.object({}).strict().default({}), 16384, true);
  const run = async () => ({
    updates: await processUpdates(),
    notifications: await deliver(),
    analytics:
      Date.now() - started < 40000
        ? await drain().catch(() => {
            log("analytics_export_retry", { code: "DRAIN_FAILED" });
            return { configured: false, sent: 0 };
          })
        : { configured: configured(), sent: 0, deferred: true },
  });
  if (!credential) return reply(await run(), id);
  // The transit proof cannot launch another endpoint or run the pipeline twice.
  const result = await transaction((tx) =>
    idempotent(
      tx,
      "scheduler:organizer-notifications",
      "POST /api/internal/organizer-notifications",
      credential.nonce,
      { stamp: credential.stamp },
      async () => ({ status: 200, body: await run() }),
    ),
  );
  return reply(result.body, id, result.status);
});
