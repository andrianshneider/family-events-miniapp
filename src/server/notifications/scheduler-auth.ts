import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { safeEqual } from "../auth/crypto";
import { setting } from "../config";
import { AppError } from "../errors";
export function schedulerCredential(
  request: Request,
  now = Math.floor(Date.now() / 1000),
) {
  if (
    safeEqual(
      request.headers.get("authorization") ?? "",
      "Bearer " + setting("CRON_SECRET"),
    )
  )
    return null;
  const stamp = request.headers.get("x-scheduler-timestamp") ?? "",
    nonce = request.headers.get("x-scheduler-nonce") ?? "",
    signature = request.headers.get("x-scheduler-signature") ?? "";
  const invalid = () =>
    new AppError(401, "INTERNAL_UNAUTHORIZED", "Недопустимый запрос.");
  if (
    !/^\d{10}$/.test(stamp) ||
    !z.uuid().safeParse(nonce).success ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    now - Number(stamp) > 120 ||
    Number(stamp) - now > 10
  )
    throw invalid();
  const expected = createHmac("sha256", setting("CRON_SECRET"))
    .update(`organizer-notifications\n${stamp}\n${nonce}`)
    .digest("hex");
  if (!safeEqual(signature, expected)) throw invalid();
  return { stamp, nonce };
}
