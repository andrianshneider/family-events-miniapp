import { endpoint, reply } from "@/server/api";
import { safeEqual } from "@/server/auth/crypto";
import { setting } from "@/server/config";
import { AppError } from "@/server/errors";
import { infrastructureHealth } from "@/server/services/health";
export const GET = endpoint(async (request, id) => {
  if (
    !safeEqual(
      request.headers.get("authorization") ?? "",
      "Bearer " + setting("CRON_SECRET"),
    )
  )
    throw new AppError(401, "INTERNAL_UNAUTHORIZED", "Недопустимый запрос.");
  return reply(await infrastructureHealth(), id);
});
