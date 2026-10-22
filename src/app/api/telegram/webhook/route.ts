import { z } from "zod";
import { endpoint, input, reply } from "@/server/api";
import { setting } from "@/server/config";
import { safeEqual, encrypt } from "@/server/auth/crypto";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
export const POST = endpoint(async (request, id) => {
  const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(secret, setting("TELEGRAM_WEBHOOK_SECRET")))
    throw new AppError(401, "WEBHOOK_UNAUTHORIZED", "Недопустимый запрос.");
  const data = await input(
    request,
    z.object({ update_id: z.number().int().nonnegative() }).passthrough(),
    262144,
  );
  const botId = setting("TELEGRAM_BOT_TOKEN").split(":")[0];
  await db()`INSERT INTO app.telegram_updates(bot_id,update_id,payload_ciphertext) VALUES(${botId},${data.update_id},${encrypt(JSON.stringify(data))}) ON CONFLICT DO NOTHING`;
  return reply({ accepted: true }, id);
});
