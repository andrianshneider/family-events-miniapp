import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "../db/client";
import { token, tokenHash, encrypt, decrypt, safeEqual } from "../auth/crypto";
import { setting } from "../config";
import { AppError } from "../errors";
import { log } from "../log";
import type { VerifiedTelegramUser } from "./init-data";
const issuer = "https://oauth.telegram.org";
const keys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json"));
export function returnPath(value: string | null) {
  if (
    value &&
    /^\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/notifications)?$/i.test(
      value,
    )
  )
    return value;
  if (
    value &&
    /^\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/guests(?:\?status=(yes|no|maybe))?$/i.test(
      value,
    )
  )
    return value;
  if (
    value &&
    /^\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(edit|share|wishlist)$/i.test(
      value,
    )
  )
    return value;
  return value === "/events" || value === "/" || value === "/events/new"
    ? value
    : "/events";
}
export async function startOidc(path: string) {
  const state = token(),
    nonce = token(),
    verifier = token();
  await db()`INSERT INTO app.auth_transactions(state_hash,nonce_hash,pkce_verifier_ciphertext,return_path,expires_at) VALUES(${tokenHash(state)},${tokenHash(nonce)},${encrypt(verifier)},${returnPath(path)},now()+interval '10 minutes')`;
  const url = new URL(issuer + "/auth");
  url.search = new URLSearchParams({
    client_id: setting("TELEGRAM_CLIENT_ID"),
    redirect_uri: setting("APP_URL") + "/api/auth/telegram/callback",
    response_type: "code",
    scope: "openid profile",
    state,
    nonce,
    code_challenge: tokenHash(verifier).toString("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url, state };
}
export async function finishOidc(
  code: string,
  state: string,
): Promise<{ user: VerifiedTelegramUser; path: string }> {
  const cookie = (await cookies()).get("__Host-fe_oidc")?.value;
  if (
    !cookie ||
    !safeEqual(cookie, state) ||
    !/^[\w-]{43}$/.test(state) ||
    code.length > 2048
  )
    throw new AppError(401, "OIDC_STATE_INVALID", "Повторите вход.");
  const [row] =
    await db()`UPDATE app.auth_transactions SET consumed_at=now() WHERE state_hash=${tokenHash(state)} AND consumed_at IS NULL AND expires_at>now() RETURNING nonce_hash,pkce_verifier_ciphertext,return_path`;
  if (!row)
    throw new AppError(401, "OIDC_TRANSACTION_EXPIRED", "Повторите вход.");
  const response = await fetch(issuer + "/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(
          setting("TELEGRAM_CLIENT_ID") +
            ":" +
            setting("TELEGRAM_CLIENT_SECRET"),
        ).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: setting("APP_URL") + "/api/auth/telegram/callback",
      client_id: setting("TELEGRAM_CLIENT_ID"),
      code_verifier: decrypt(row.pkce_verifier_ciphertext),
    }),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AppError(401, "OIDC_EXCHANGE_FAILED", "Повторите вход.");
  const result = await response.json();
  if (typeof result.id_token !== "string")
    throw new AppError(401, "OIDC_TOKEN_INVALID", "Повторите вход.");
  let claims;
  try {
    claims = (
      await jwtVerify(result.id_token, keys, {
        issuer,
        audience: setting("TELEGRAM_CLIENT_ID"),
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub", "nonce"],
      })
    ).payload;
  } catch {
    throw new AppError(401, "OIDC_TOKEN_INVALID", "Повторите вход.");
  }
  if (
    typeof claims.nonce !== "string" ||
    !tokenHash(claims.nonce).equals(Buffer.from(row.nonce_hash))
  )
    throw new AppError(401, "OIDC_NONCE_INVALID", "Повторите вход.");
  // The signed profile claim `id`, not OIDC `sub`, is the Mini App Telegram ID.
  const telegramId =
    typeof claims.id === "number"
      ? claims.id
      : typeof claims.id === "string" && /^[1-9][0-9]{0,15}$/.test(claims.id)
        ? Number(claims.id)
        : NaN;
  if (
    !Number.isSafeInteger(telegramId) ||
    telegramId <= 0 ||
    typeof claims.name !== "string" ||
    !claims.name.trim()
  ) {
    log("oidc_profile_unmapped", {
      idType: typeof claims.id,
      nameType: typeof claims.name,
      idValid: Number.isSafeInteger(telegramId) && telegramId > 0,
      nameValid: typeof claims.name === "string" && !!claims.name.trim(),
    });
    throw new AppError(
      401,
      "OIDC_IDENTITY_UNMAPPED",
      "Telegram не подтвердил идентификатор аккаунта.",
    );
  }
  return {
    path: returnPath(row.return_path),
    user: {
      telegramId: String(telegramId),
      displayName: claims.name.slice(0, 128),
      username:
        typeof claims.preferred_username === "string"
          ? claims.preferred_username
          : null,
      avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
      locale: "ru",
    },
  };
}
