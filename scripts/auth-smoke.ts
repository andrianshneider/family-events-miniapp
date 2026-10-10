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
const stagingRef = "jjrjdogsjbdvacusvnki";
const connection = new URL(process.env.DATABASE_URL);
if (
  root !== "https://family-events-staging.vercel.app" ||
  new URL(process.env.SUPABASE_URL ?? "https://invalid").hostname !==
    stagingRef + ".supabase.co" ||
  !(
    connection.hostname.includes(stagingRef) ||
    decodeURIComponent(connection.username).includes(stagingRef)
  )
)
  throw new Error(
    "This fixture smoke is restricted to the existing staging environment",
  );
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: databaseTls(),
});
const tid = String(
  BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n,
);
let userId: string | undefined,
  guestToken: string | undefined,
  otherId: string | undefined;
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
  const initData = payload();
  const login = await post(initData);
  assert.equal(login.status, 200);
  userId = (await login.json()).data.id;
  const orgCookie = cookie(login, "__Host-fe_org", 30 * 86400);
  assert.equal((await post(initData)).status, 401);
  const retried = await fetch(root + "/api/auth/telegram/mini-app", {
    method: "POST",
    headers: {
      Origin: new URL(root).origin,
      "Content-Type": "application/json",
      Cookie: orgCookie,
    },
    body: JSON.stringify({ initData }),
  });
  assert.equal(retried.status, 200);
  assert.equal(cookie(retried, "__Host-fe_org", 30 * 86400), orgCookie);
  const profile = await fetch(root + "/api/v1/me", {
    headers: { Cookie: orgCookie },
  });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).data.id, userId);
  const publicEvents = await fetch(root + "/api/v1/events");
  assert.equal(publicEvents.status, 401);
  const list = () =>
    fetch(root + "/api/v1/events", { headers: { Cookie: orgCookie } });
  assert.equal((await (await list()).json()).data.events.length, 0);
  const [fixture] =
    await sql`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${userId!},${randomBytes(16).toString("base64url")},'Infrastructure event smoke','family','2027-01-01','UTC','2027-01-01T00:00Z') RETURNING id`;
  const items = (await (await list()).json()).data.events;
  assert.deepEqual(
    items.map((e: { id: string }) => e.id),
    [fixture.id],
  );
  await sql`UPDATE app.events SET deleted_at=now() WHERE id=${fixture.id} AND organizer_id=${userId!}`;
  assert.equal((await (await list()).json()).data.events.length, 0);
  const [other] =
    await sql`INSERT INTO app.users(telegram_user_id,display_name) VALUES(${String(BigInt(tid) + 1n)},'Infrastructure smoke other') RETURNING id`;
  otherId = other.id;
  const prefix = randomBytes(12).toString("base64url");
  const [foreign] =
    await sql`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${otherId!},${randomBytes(16).toString("base64url")},'Other smoke event','family','2027-01-01','UTC','2027-01-01T00:00Z') RETURNING id`;
  await sql`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) SELECT ${userId!},${prefix}||lpad(n::text,6,'0'),'Infrastructure pagination smoke','family','2027-01-01','UTC','2027-01-01T00:00Z' FROM generate_series(1,103) n`;
  const page = await fetch(root + "/api/v1/events?organizer_id=" + otherId, {
    headers: { Cookie: orgCookie },
  });
  assert.equal(page.headers.get("cache-control"), "private, no-store");
  const first = (await page.json()).data;
  assert.equal(first.events.length, 100);
  assert(first.nextCursor);
  const rest = (
    await (
      await fetch(root + "/api/v1/events?cursor=" + first.nextCursor, {
        headers: { Cookie: orgCookie },
      })
    ).json()
  ).data;
  assert.equal(rest.events.length, 3);
  assert.equal(rest.nextCursor, null);
  const ids = [...first.events, ...rest.events].map(
    (event: { id: string }) => event.id,
  );
  assert.equal(new Set(ids).size, 103);
  assert(!ids.includes(foreign.id) && !ids.includes(fixture.id));
  assert.equal(
    (
      await fetch(root + "/api/v1/events?cursor=invalid", {
        headers: { Cookie: orgCookie },
      })
    ).status,
    422,
  );
  const screen = await fetch(root + "/events", {
    headers: { Cookie: orgCookie },
  });
  assert.equal(screen.status, 200);
  assert((await screen.text()).includes("Мои события"));
  const refreshed = await fetch(root + "/events", {
    headers: { Cookie: orgCookie },
  });
  assert.equal(refreshed.status, 200);
  const tokenHash = createHash("sha256")
    .update(orgCookie.split("=")[1])
    .digest();
  await sql`UPDATE app.organizer_sessions SET created_at=now()-interval '31 days',expires_at=now()-interval '1 second' WHERE token_hash=${tokenHash}`;
  assert.equal(
    (await fetch(root + "/api/v1/me", { headers: { Cookie: orgCookie } }))
      .status,
    401,
  );
  const expired = await fetch(root + "/events", {
    headers: { Cookie: orgCookie },
    redirect: "manual",
  });
  assert.equal(expired.status, 307);
  assert(new URL(expired.headers.get("location")!, root).pathname === "/login");
  await sql`UPDATE app.organizer_sessions SET expires_at=now()+interval '30 days' WHERE token_hash=${tokenHash}`;
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
    "PASS: staging signed initData, stale/forged/replay rejection, same-session retry, secure cookies, profile, empty state, real DB events, pagination, owner isolation, refresh, expiry redirect, CSRF, logout revocation. Synthetic identities only; real Telegram and iPhone sign-in require device verification.",
  );
} catch {
  console.error("Auth smoke failed; tokens and payloads not printed.");
  process.exitCode = 1;
} finally {
  await sql.begin(async (tx) => {
    const [owned] =
      await tx`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Infrastructure smoke' AND created_at>=${startedAt}`;
    if (owned) {
      await tx`DELETE FROM app.events WHERE organizer_id=${owned.id}`;
      await tx`DELETE FROM app.mini_app_logins WHERE session_hash IN (SELECT token_hash FROM app.organizer_sessions WHERE user_id=${owned.id})`;
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${owned.id}`;
      await tx`DELETE FROM app.users WHERE id=${owned.id}`;
    }
    if (otherId) {
      const [other] =
        await tx`SELECT id FROM app.users WHERE id=${otherId} AND telegram_user_id=${String(BigInt(tid) + 1n)} AND display_name='Infrastructure smoke other' AND created_at>=${startedAt}`;
      if (other) {
        await tx`DELETE FROM app.events WHERE organizer_id=${other.id}`;
        await tx`DELETE FROM app.users WHERE id=${other.id}`;
      }
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
