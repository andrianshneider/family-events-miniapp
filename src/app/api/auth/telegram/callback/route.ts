import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { endpoint } from "@/server/api";
import { finishOidc } from "@/server/telegram/oidc";
import { login } from "@/server/services/auth";
import { ORG_COOKIE, ORG_TTL, sessionCookie } from "@/server/auth/sessions";
import { tokenHash } from "@/server/auth/crypto";
import { setting } from "@/server/config";
import { AppError } from "@/server/errors";
export const GET = endpoint(async (request) => {
  const p = new URL(request.url).searchParams;
  const code = p.get("code"),
    state = p.get("state");
  let identity;
  try {
    if (!code || !state)
      throw new AppError(401, "OIDC_CANCELLED", "Вход не завершён.");
    identity = await finishOidc(code, state);
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 401) throw error;
    const response = NextResponse.redirect(
      new URL("/login?error=telegram", setting("APP_URL")),
    );
    sessionCookie(response, "__Host-fe_oidc", "", 0);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const { user, path } = identity;
  const previous = (await cookies()).get(ORG_COOKIE)?.value;
  const result = await login(user, previous ? tokenHash(previous) : undefined);
  const response = NextResponse.redirect(new URL(path, setting("APP_URL")));
  sessionCookie(response, ORG_COOKIE, result.raw, ORG_TTL);
  sessionCookie(response, "__Host-fe_oidc", "", 0);
  response.headers.set("Cache-Control", "no-store");
  return response;
});
