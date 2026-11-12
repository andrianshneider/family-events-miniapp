import "server-only";
import { cookies } from "next/headers";
import { AppError } from "../errors";
import { setting } from "../config";
import { csrf, safeEqual } from "./crypto";
export function requireOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(setting("APP_URL")).origin)
    throw new AppError(
      403,
      "ORIGIN_REJECTED",
      "Недопустимый источник запроса.",
    );
}
export async function requireMutation(request: Request, cookieName: string) {
  requireOrigin(request);
  const raw = (await cookies()).get(cookieName)?.value;
  const supplied = request.headers.get("x-csrf-token");
  if (!raw || !supplied || !safeEqual(csrf(raw), supplied))
    throw new AppError(403, "CSRF_REJECTED", "Обновите страницу и повторите.");
}
