import "server-only";
import { createHmac } from "node:crypto";
import { db } from "../db/client";
import { setting } from "../config";
import { AppError } from "../errors";
export async function limit(
  request: Request,
  category: string,
  max: number,
  subject?: string,
) {
  // x-vercel-forwarded-for is set by Vercel. Do not trust arbitrary X-Forwarded-For.
  const ip =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : "local";
  if (!ip)
    throw new AppError(
      503,
      "PROXY_UNAVAILABLE",
      "Не удалось проверить запрос.",
    );
  const key = createHmac("sha256", setting("RATE_LIMIT_SECRET"))
    .update(category + ":" + (subject ?? ip))
    .digest();
  const [row] =
    await db()`INSERT INTO app.rate_limits(key_hash,window_start,hits) VALUES(${key},date_trunc('minute',now()),1) ON CONFLICT(key_hash,window_start) DO UPDATE SET hits=app.rate_limits.hits+1 RETURNING hits`;
  if (row.hits > max)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Слишком много запросов. Повторите через минуту.",
    );
}
