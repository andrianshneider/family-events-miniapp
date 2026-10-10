import { it, expect, vi } from "vitest";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
// Exercise the actual verifier with a deterministic JWKS endpoint.
const { setCookie, runQuery } = vi.hoisted(() => ({
  setCookie: vi.fn(),
  runQuery: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => setCookie() }),
}));
vi.mock("@/server/db/client", () => ({ db: () => runQuery }));
import { finishOidc } from "@/server/telegram/oidc";
import { encrypt, tokenHash } from "@/server/auth/crypto";
it("validates JWT identity mapping, nonce, audience and replay transaction", async () => {
  process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString("base64");
  process.env.TELEGRAM_CLIENT_ID = "123";
  process.env.TELEGRAM_CLIENT_SECRET = "test";
  process.env.APP_URL = "https://example.test";
  const state = "a".repeat(43);
  setCookie.mockReturnValue({ value: state });
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  async function jwt(
    claims: Record<string, unknown>,
    aud = "123",
    tokenIssuer = "https://oauth.telegram.org",
    expires: string | number = "5m",
    key = privateKey,
  ) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(tokenIssuer)
      .setAudience(aud)
      .setSubject("different-oidc-sub")
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(key);
  }
  let token = await jwt({ id: 123456, name: "Иван", nonce: "valid-nonce" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) =>
      String(url).includes("jwks")
        ? new Response(JSON.stringify({ keys: [jwk] }), {
            headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({ id_token: token }), {
            headers: { "Content-Type": "application/json" },
          }),
    ),
  );
  runQuery.mockImplementation(async () => [
    {
      nonce_hash: tokenHash("valid-nonce"),
      pkce_verifier_ciphertext: encrypt("verifier"),
      return_path: "/events",
    },
  ]);
  expect((await finishOidc("code", state)).user.telegramId).toBe("123456");
  token = await jwt({ id: "123456", name: "Иван", nonce: "valid-nonce" });
  expect((await finishOidc("code", state)).user.telegramId).toBe("123456");
  for (const id of ["123abc", "1e3", "-1", "9007199254740992", 1.5]) {
    token = await jwt({ id, name: "Иван", nonce: "valid-nonce" });
    await expect(finishOidc("code", state)).rejects.toThrow();
  }
  token = await jwt({ id: 123456, name: "Иван", nonce: "wrong" });
  await expect(finishOidc("code", state)).rejects.toThrow();
  token = await jwt({ name: "Иван", nonce: "valid-nonce" });
  await expect(finishOidc("code", state)).rejects.toThrow();
  token = await jwt(
    { id: 123456, name: "Иван", nonce: "valid-nonce" },
    "other-client",
  );
  await expect(finishOidc("code", state)).rejects.toThrow();
  token = await jwt(
    { id: 123456, name: "Иван", nonce: "valid-nonce" },
    "123",
    "https://invalid.test",
  );
  await expect(finishOidc("code", state)).rejects.toThrow();
  token = await jwt(
    { id: 123456, name: "Иван", nonce: "valid-nonce" },
    "123",
    "https://oauth.telegram.org",
    Math.floor(Date.now() / 1000) - 1,
  );
  await expect(finishOidc("code", state)).rejects.toThrow();
  const wrongKey = await generateKeyPair("RS256");
  token = await jwt(
    { id: 123456, name: "Иван", nonce: "valid-nonce" },
    "123",
    "https://oauth.telegram.org",
    "5m",
    wrongKey.privateKey,
  );
  await expect(finishOidc("code", state)).rejects.toThrow();
  runQuery.mockClear();
  setCookie.mockReturnValue({ value: "b".repeat(43) });
  await expect(finishOidc("code", state)).rejects.toThrow();
  expect(runQuery).not.toHaveBeenCalled();
  setCookie.mockReturnValue(undefined);
  await expect(finishOidc("code", state)).rejects.toThrow();
  expect(runQuery).not.toHaveBeenCalled();
  setCookie.mockReturnValue({ value: state });
  runQuery.mockResolvedValue([]);
  await expect(finishOidc("code", state)).rejects.toThrow();
  vi.unstubAllGlobals();
});
