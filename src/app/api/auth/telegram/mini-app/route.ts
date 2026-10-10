import { z } from "zod";
import { cookies } from "next/headers";
import { endpoint, input, reply } from "@/server/api";
import { requireOrigin } from "@/server/auth/csrf";
import { limit } from "@/server/auth/rate-limit";
import { ORG_COOKIE, ORG_TTL, sessionCookie } from "@/server/auth/sessions";
import { setting } from "@/server/config";
import { validateInitData } from "@/server/telegram/init-data";
import { loginMiniApp } from "@/server/services/auth";
export const POST = endpoint(async (request, id) => {
  requireOrigin(request);
  await limit(request, "auth", Number(process.env.AUTH_RATE_LIMIT ?? 10));
  const data = await input(
    request,
    z.object({ initData: z.string().min(1).max(16384) }).strict(),
  );
  const user = validateInitData(data.initData, setting("TELEGRAM_BOT_TOKEN"));
  const previous = (await cookies()).get(ORG_COOKIE)?.value;
  const result = await loginMiniApp(user, data.initData, previous);
  const response = reply(result.user, id);
  sessionCookie(response, ORG_COOKIE, result.raw, ORG_TTL);
  return response;
});
