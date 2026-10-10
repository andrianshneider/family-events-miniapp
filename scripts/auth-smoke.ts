// Synthetic signed payload test. This does NOT claim a real Telegram/OIDC login UI test.
import nextEnv from "@next/env";
import postgres from "postgres";
import { createHash, createHmac, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { databaseTls } from "../src/server/db/tls";
nextEnv.loadEnvConfig(process.cwd());
const root = process.env.SMOKE_URL ?? process.env.APP_URL,
  bot = process.env.TELEGRAM_BOT_TOKEN;
if (!root || !bot || !process.env.DATABASE_URL)
  throw new Error("Configured staging, bot and runtime DB required");
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: databaseTls(),
});
const tid = String(
  BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n,
);
let userId: string | undefined, guestToken: string | undefined;
const startedAt = new Date();
function payload(age = 0) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - age),
    user: JSON.stringify({
      id: Number(tid),
      first_name: "Infrastructure smoke",
    }),
  });
  const secret = createHmac("sha256", "WebAppData").update(bot!).digest();
  p.set(
    "hash",
    createHmac("sha256", secret)
      .update(
        [...p.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => k + "=" + v)
          .join("\n"),
      )
      .digest("hex"),
  );
  return p.toString();
}
function cookie(response: Response, name: string, ttl: number) {
  const raw = response.headers
    .getSetCookie()
    .find((v) => v.startsWith(name + "="));
  assert(raw);
  assert(
    raw.includes("HttpOnly") &&
      raw.includes("Secure") &&
      raw.includes("SameSite=lax"),
  );
  assert(raw.includes("Max-Age=" + ttl));
  return raw.split(";")[0];
}
try {
  assert.equal(
    (await sql`SELECT id FROM app.users WHERE telegram_user_id=${tid}`).length,
    0,
  );
  const post = (data: string) =>
    fetch(root + "/api/auth/telegram/mini-app", {
      method: "POST",
      headers: {
        Origin: new URL(root).origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ initData: data }),
    });
  const invalid = await post(payload(301));
  assert.equal(invalid.status, 401);
  const forged = await post(payload().replace("Infrastructure", "Forged"));
  assert.equal(forged.status, 401);
  const login = await post(payload());
  assert.equal(login.status, 200);
  userId = (await login.json()).data.id;
  const orgCookie = cookie(login, "__Host-fe_org", 30 * 86400);
  const profile = await fetch(root + "/api/v1/me", {
    headers: { Cookie: orgCookie },
  });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).data.id, userId);
  const csrf = await fetch(root + "/api/auth/csrf", {
    headers: { Cookie: orgCookie },
  });
  const csrfToken = (await csrf.json()).data.csrfToken;
  const rejected = await fetch(root + "/api/auth/logout", {
    method: "POST",
    headers: { Origin: new URL(root).origin, Cookie: orgCookie },
  });
  assert.equal(rejected.status, 403);
  const logout = await fetch(root + "/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: new URL(root).origin,
      Cookie: orgCookie,
      "X-CSRF-Token": csrfToken,
    },
  });
  assert.equal(logout.status, 200);
  assert.equal(
    (await fetch(root + "/api/v1/me", { headers: { Cookie: orgCookie } }))
      .status,
    401,
  );
  const guest = await fetch(root + "/api/guest/session", {
    method: "POST",
    headers: { Origin: new URL(root).origin },
  });
  assert.equal(guest.status, 201);
  const guestCookie = cookie(guest, "__Host-fe_guest", 180 * 86400);
  guestToken = guestCookie.split("=")[1];
  const guestCsrf = await fetch(root + "/api/auth/csrf?context=guest", {
    headers: { Cookie: guestCookie },
  });
  assert.equal(guestCsrf.status, 200);
  console.info(
    "PASS: staging signed initData, stale/forged rejection, secure 30/180-day cookies, profile, CSRF, logout revocation, anonymous Guest session. Synthetic identities only.",
  );
} catch {
  console.error("Auth smoke failed; tokens and payloads not printed.");
  process.exitCode = 1;
} finally {
  await sql.begin(async (tx) => {
    const [owned] =
      await tx`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Infrastructure smoke' AND created_at>=${startedAt}`;
    if (owned) {
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${owned.id}`;
      await tx`DELETE FROM app.users WHERE id=${owned.id}`;
    }
    if (guestToken) {
      const hash = createHash("sha256").update(guestToken).digest();
      const [g] =
        await tx`DELETE FROM app.guest_sessions WHERE token_hash=${hash} AND created_at>=${startedAt} RETURNING guest_identity_id`;
      if (g)
        await tx`DELETE FROM app.guest_identities WHERE id=${g.guest_identity_id} AND linked_user_id IS NULL`;
    }
  });
  await sql.end();
}
