import { endpoint, reply } from "@/server/api";
import { drain,queueHealth } from "@/server/analytics/exporter";
import { safeEqual } from "@/server/auth/crypto";
import { setting } from "@/server/config";
import { AppError } from "@/server/errors";
export const maxDuration = 30;
export const POST = endpoint(async (req, id) => {
  if (
    !safeEqual(
      req.headers.get("authorization") ?? "",
      "Bearer " + setting("CRON_SECRET"),
    )
  )
    throw new AppError(401, "INTERNAL_UNAUTHORIZED", "Недопустимый запрос.");
  return reply(await drain(), id);
});

export const GET=endpoint(async(req,id)=>{
 if(!safeEqual(req.headers.get("authorization")??"","Bearer "+setting("CRON_SECRET")))throw new AppError(401,"INTERNAL_UNAUTHORIZED","Недопустимый запрос.");
 return reply(await queueHealth(),id);
});
