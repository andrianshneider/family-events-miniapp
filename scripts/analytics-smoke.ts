// Existing staging only. Synthetic fixture owners, gifts, reservations and Storage files.
import nextEnv from "@next/env";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import postgres from "postgres";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { databaseTls } from "../src/server/db/tls";
nextEnv.loadEnvConfig(process.cwd());
const root = "https://family-events-staging.vercel.app",
  ref = "jjrjdogsjbdvacusvnki",
  started = new Date(),
  connection = new URL(process.env.DATABASE_URL!);
if (
  (process.env.SMOKE_URL && process.env.SMOKE_URL !== root) ||
  new URL(process.env.SUPABASE_URL!).hostname !== ref + ".supabase.co" ||
  !(
    connection.hostname.includes(ref) ||
    decodeURIComponent(connection.username).includes(ref)
  )
)
  throw Error("Existing staging only");
const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    ssl: databaseTls(),
  }),
  storage = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).storage.from(process.env.SUPABASE_MEDIA_BUCKET ?? "event-media");
type Actor = { id: string; cookie: string; csrf: string };
const tids = [0, 1].map(() =>
    String(BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n),
  ),
  guestIds = new Set<string>();
const analyticsGroups = new Set<string>();
const fixturePath = `.secrets/pwa-smoke-${randomUUID()}.json`;
async function remember() {
  await mkdir(".secrets", { recursive: true, mode: 0o700 });
  await writeFile(
    fixturePath,
    JSON.stringify({
      tids,
      guestIds: [...guestIds],
      analyticsGroups: [...analyticsGroups],
      started: started.toISOString(),
    }),
    { mode: 0o600 },
  );
}
let phase = "login";
const budgets = new Map<string, { minute: number; count: number }>();
const request = async (
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
  csrf?: string,
  key = randomUUID(),
) => {
  if (
    cookie &&
    method !== "GET" &&
    /\/events\/[^/]+\/(gifts|wishlist)/.test(path)
  ) {
    let minute = Math.floor(Date.now() / 60000),
      budget = budgets.get(cookie);
    if (budget?.minute === minute && budget.count >= 24) {
      const until = (minute + 1) * 60000 + 1500;
      while (Date.now() < until)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(30000, until - Date.now())),
        );
      minute = Math.floor(Date.now() / 60000);
    }
    budget = budgets.get(cookie);
    budgets.set(cookie, {
      minute,
      count: budget?.minute === minute ? budget.count + 1 : 1,
    });
  }
  return fetch(root + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: root,
      "Content-Type": "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      "idempotency-key": key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
};
async function login(tid: string): Promise<Actor> {
  const p = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: randomUUID(),
      user: JSON.stringify({ id: Number(tid), first_name: "Analytics smoke" }),
    }),
    secret = createHmac("sha256", "WebAppData")
      .update(process.env.TELEGRAM_BOT_TOKEN!)
      .digest();
  p.set(
    "hash",
    createHmac("sha256", secret)
      .update(
        [...p.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => k + "=" + v)
          .join("\n"),
      )
      .digest("hex"),
  );
  const r = await request("/api/auth/telegram/mini-app", "", "POST", {
    initData: p.toString(),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers
      .getSetCookie()
      .find((v) => v.startsWith("__Host-fe_org="))!
      .split(";")[0],
    profile = (await r.json()).data;
  const csrf = (await (await request("/api/auth/csrf", cookie)).json()).data
    .csrfToken;
  return { id: profile.id, cookie, csrf };
}
async function data(r: Response, status = 200) {
  assert.equal(r.status, status);
  return (await r.json()).data;
}
async function guest() {
  const r = await request("/api/guest/session", "", "POST", {});
  assert.equal(r.status, 201);
  const cookie = r.headers
    .getSetCookie()
    .find((v) => v.startsWith("__Host-fe_guest="))!
    .split(";")[0];
  const csrf = (
    await data(await request("/api/auth/csrf?context=guest", cookie))
  ).csrfToken;
  // Cleanup tracks only the identity created by this request, not any real Guest.
  const { createHash } = await import("node:crypto");
  const [row] =
    await sql`SELECT guest_identity_id FROM app.guest_sessions WHERE token_hash=${createHash("sha256").update(cookie.split("=")[1]).digest()}`;
  guestIds.add(row.guest_identity_id);
  await remember();
  return { cookie, csrf };
}

async function consent(a: { cookie: string }, allow: boolean) {
  const r = await request("/api/analytics/consent", a.cookie, "POST", {
    allow,
  });
  await data(r);
  const value = r.headers
    .getSetCookie()
    .find((v) => v.startsWith("__Host-fe_analytics="))!
    .split(";")[0];
  if (allow) {
    const { createHash } = await import("node:crypto");
    const [v] =
      await sql`SELECT id,consent_group FROM app.analytics_visitors WHERE token_hash=${createHash("sha256").update(value.split("=")[1]).digest()}`;
    assert(v);
    analyticsGroups.add(v.consent_group);
    await remember();
    await sql`UPDATE app.analytics_visitors SET traffic_class='synthetic' WHERE id=${v.id}`;
  }
  return { ...a, cookie: a.cookie + "; " + value };
}
async function authenticateConsented(a: Actor, tid: string) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id: Number(tid), first_name: "Analytics smoke" }),
  });
  const secret = createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN!)
    .digest();
  p.set(
    "hash",
    createHmac("sha256", secret)
      .update(
        [...p.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => k + "=" + v)
          .join("\n"),
      )
      .digest("hex"),
  );
  const response = await request(
    "/api/auth/telegram/mini-app",
    a.cookie,
    "POST",
    { initData: p.toString() },
  );
  const profile = await data(response);
  assert.equal(profile.id, a.id);
  const org = response.headers
    .getSetCookie()
    .find((v) => v.startsWith("__Host-fe_org="))!
    .split(";")[0];
  const cookie =
    org +
    "; " +
    a.cookie.split("; ").find((v) => v.startsWith("__Host-fe_analytics="));
  const again = await request("/api/auth/telegram/mini-app", cookie, "POST", {
    initData: p.toString(),
  });
  await data(again);
  assert.equal(
    (
      await sql`SELECT id FROM app.analytics_events WHERE name='user_authenticated' AND user_id=${a.id} AND schema_version='1.0'`
    ).length,
    1,
  );
  return {
    ...a,
    cookie,
    csrf: (await data(await request("/api/auth/csrf", cookie))).csrfToken,
  };
}
async function capture(
  a: { cookie: string },
  name: string,
  props: Record<string, unknown>,
  publicId?: string,
  id = randomUUID(),
) {
  return request("/api/analytics/collect", a.cookie, "POST", {
    name,
    id,
    occurredAt: new Date().toISOString(),
    platform: "web",
    ...(publicId ? { locator: { kind: "public", id: publicId } } : {}),
    properties: props,
  });
}
try {
  await remember();
  phase = "deployed analytics context and denied-by-default";
  const empty = await data(
    await request("/api/analytics/context", "", "POST", {}),
  );
  assert.equal(empty.enabled, true);
  assert.equal(empty.consent, false);
  let owner = await login(tids[0]);
  await sql`INSERT INTO app.analytics_traffic(user_id,classification) VALUES(${owner.id},'synthetic')`;
  const denied = await request(
    "/api/v1/events",
    owner.cookie,
    "POST",
    {
      title: "Analytics denied fixture",
      eventType: "family",
      eventDate: "2030-01-01",
      timezone: "UTC",
    },
    owner.csrf,
  );
  const deniedEvent = await data(denied, 201);
  assert.equal(
    (
      await sql`SELECT id FROM app.analytics_events WHERE event_id=${deniedEvent.id}`
    ).length,
    0,
  );
  owner = { ...owner, ...(await consent(owner, true)) };
  await data(
    await capture(owner, "app_entered", { entry_point: "direct" }),
    202,
  );
  owner = await authenticateConsented(owner, tids[0]);
  phase = "committed event fact, retry and sanitized metadata";
  const key = randomUUID(),
    payload = {
      title: "Analytics CANARY title",
      eventType: "family",
      eventDate: "2030-01-01",
      timezone: "UTC",
      address: "CANARY address",
      description: "CANARY email@example.test",
      dressCode: "CANARY dress code",
    };
  const e = await data(
    await request(
      "/api/v1/events",
      owner.cookie,
      "POST",
      payload,
      owner.csrf,
      key,
    ),
    201,
  );
  assert.deepEqual(
    await data(
      await request(
        "/api/v1/events",
        owner.cookie,
        "POST",
        payload,
        owner.csrf,
        key,
      ),
      201,
    ),
    e,
  );
  assert.equal(
    (
      await sql`SELECT id FROM app.analytics_events WHERE event_id=${e.id} AND name='event_created' AND schema_version='1.0'`
    ).length,
    1,
  );
  phase = "SSR and API polling do not track or create Guest Session";
  const before = (
    await sql`SELECT count(*)::int AS n FROM app.guest_identities`
  )[0].n;
  for (let i = 0; i < 3; i++) {
    assert.equal((await request(`/e/${e.publicId}`)).status, 200);
    await data(await request(`/api/v1/public/events/${e.publicId}`));
  }
  assert.equal(
    (await sql`SELECT count(*)::int AS n FROM app.guest_identities`)[0].n,
    before,
  );
  assert.equal(
    (
      await sql`SELECT id FROM app.analytics_events WHERE event_id=${e.id} AND name='event_viewed'`
    ).length,
    0,
  );
  phase = "anonymous bridge, collector allowlist, first touch and dedup";
  let a = await guest();
  const b = await guest();
  a = { ...a, ...(await consent(a, true)) };
  const viewId = randomUUID(),
    view = {
      view_mode: "public",
      navigation_id: randomUUID(),
      actor_relation: "known_owner",
      event_id: randomUUID(),
    };
  await data(await capture(a, "event_viewed", view, e.publicId, viewId), 202);
  await data(await capture(a, "event_viewed", view, e.publicId, viewId), 202);
  const viewRows =
    await sql`SELECT distinct_id,properties FROM app.analytics_events WHERE id=${viewId}`;
  assert.equal(viewRows.length, 1);
  assert.equal(viewRows[0].properties.event_id, e.id);
  assert.equal(viewRows[0].properties.actor_relation, "unknown");
  assert.equal(
    (await capture(a, "event_viewed", { ...view, title: "CANARY" }, e.publicId))
      .status,
    422,
  );
  assert.equal((await capture(a, "event_created", {}, e.publicId)).status, 422);
  const original = {
    guestName: "Analytics CANARY guest",
    status: "yes",
    adultsCount: 1,
    childrenCount: 0,
    comment: "CANARY token=email@example.test",
    expectedVersion: null,
  };
  const pub = `/api/v1/public/events/${e.publicId}`;
  const rsvpKey = randomUUID(),
    r = await data(
      await request(pub + "/rsvp", a.cookie, "PUT", original, a.csrf, rsvpKey),
    );
  await data(
    await request(pub + "/rsvp", a.cookie, "PUT", original, a.csrf, rsvpKey),
  );
  await data(
    await request(
      pub + "/rsvp",
      a.cookie,
      "PUT",
      { ...original, expectedVersion: r.rsvp.version },
      a.csrf,
    ),
  );
  const facts =
    await sql`SELECT distinct_id,properties FROM app.analytics_events WHERE event_id=${e.id} AND name='rsvp_submitted'`;
  assert.equal(facts.length, 1);
  assert.equal(facts[0].distinct_id, viewRows[0].distinct_id);
  assert.equal(
    (
      await sql`SELECT origin_event_id FROM app.guest_identities WHERE id=${[...guestIds][0]}`
    )[0].origin_event_id,
    e.id,
  );
  phase = "wishlist, atomic reservation and conflict without second success";
  const gift = await data(
    await request(
      `/api/v1/events/${e.id}/gifts`,
      owner.cookie,
      "POST",
      {
        title: "Analytics CANARY gift",
        externalUrl: "https://example.test/CANARY?token=CANARY",
        comment: "CANARY gift text",
      },
      owner.csrf,
    ),
    201,
  );
  await data(
    await capture(
      a,
      "wishlist_viewed",
      { surface: "full", is_empty: false, navigation_id: randomUUID() },
      e.publicId,
    ),
    202,
  );
  const reservedPath = pub + `/gifts/${gift.id}/reservation`,
    reserveKey = randomUUID();
  await data(
    await request(reservedPath, a.cookie, "POST", {}, a.csrf, reserveKey),
    201,
  );
  await data(
    await request(reservedPath, a.cookie, "POST", {}, a.csrf, reserveKey),
    201,
  );
  assert.equal(
    (
      await request(
        reservedPath,
        b.cookie,
        "POST",
        { guestName: "Other CANARY guest" },
        b.csrf,
      )
    ).status,
    409,
  );
  const chosen =
    await sql`SELECT distinct_id,properties FROM app.analytics_events WHERE event_id=${e.id} AND name='gift_reserved'`;
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].distinct_id, viewRows[0].distinct_id);
  assert.equal(chosen[0].properties.gift_id, gift.id);
  phase = "privacy and withdrawal suppress queued captures";
  const all =
    await sql`SELECT properties FROM app.analytics_events WHERE event_id=${e.id} AND schema_version='1.0'`;
  const serialized = JSON.stringify(all);
  for (const canary of [
    "CANARY",
    e.publicId,
    "email@example.test",
    "https://example.test",
  ])
    assert(!serialized.includes(canary));
  await consent(a, false);
  const count = (
    await sql`SELECT id FROM app.analytics_events WHERE event_id=${e.id}`
  ).length;
  await data(
    await capture(
      a,
      "event_viewed",
      { ...view, navigation_id: randomUUID() },
      e.publicId,
    ),
    202,
  );
  assert.equal(
    (await sql`SELECT id FROM app.analytics_events WHERE event_id=${e.id}`)
      .length,
    count,
  );
  assert.equal(
    (
      await sql`SELECT id FROM app.analytics_events WHERE visitor_id IN(SELECT id FROM app.analytics_visitors WHERE consent_group IN(SELECT consent_group FROM app.analytics_visitors WHERE id=${viewRows[0].distinct_id})) AND delivery_status='pending'`
    ).length,
    0,
  );
  console.info(
    "PASS: staging opt-in default/withdrawal; committed create/RSVP/reservation dedup; same anonymous actor and internal Event UUID; first-touch; no SSR/poll/crawler facts or Guest bootstrap; privacy canaries and forged-source rejection. HTTP collector fixtures only; no real PostHog delivery or physical UI claim.",
  );
} catch (error) {
  const n =
    error instanceof assert.AssertionError &&
    typeof error.actual === "number" &&
    typeof error.expected === "number"
      ? ` expected ${error.expected}, got ${error.actual}`
      : "";
  console.error(
    `Analytics staging smoke failed at ${phase}.${n}; secrets/payloads suppressed.`,
  );
  process.exitCode = 1;
} finally {
  for (const group of analyticsGroups) {
    await sql`DELETE FROM app.analytics_events WHERE visitor_id IN(SELECT id FROM app.analytics_visitors WHERE consent_group=${group} AND created_at>=${started})`;
    await sql`DELETE FROM app.analytics_visitors WHERE consent_group=${group} AND created_at>=${started}`;
  }
  for (const id of guestIds)
    await sql`UPDATE app.guest_identities SET origin_event_id=NULL,origin_first_seen_at=NULL WHERE id=${id}`;
  for (const tid of tids) {
    const [owner] =
      await sql`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Analytics smoke' AND created_at>=${started}`;
    if (!owner) continue;
    const assets =
      await sql`SELECT id,storage_path FROM app.media_assets WHERE owner_user_id=${owner.id}`;
    const paths = [
      ...new Set(
        assets.flatMap((a) => [
          a.storage_path,
          a.storage_path.replace(/\.webp$/, ".thumb.webp"),
        ]),
      ),
    ];
    if (paths.length) {
      const result = await storage.remove(paths);
      if (result.error) throw Error("Synthetic Storage cleanup failed");
    }
    await sql.begin(async (tx) => {
      await tx`DELETE FROM app.gift_reservations WHERE gift_id IN(SELECT g.id FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id JOIN app.events e ON e.id=w.event_id WHERE e.organizer_id=${owner.id})`;
      await tx`DELETE FROM app.gifts WHERE wishlist_id IN(SELECT w.id FROM app.wishlists w JOIN app.events e ON e.id=w.event_id WHERE e.organizer_id=${owner.id})`;
      await tx`DELETE FROM app.analytics_events WHERE user_id=${owner.id} OR event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"organizer:" + owner.id}`;
      await tx`DELETE FROM app.rsvps WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
      await tx`DELETE FROM app.event_changes WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
      await tx`DELETE FROM app.wishlists WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
      await tx`DELETE FROM app.events WHERE organizer_id=${owner.id}`;
      await tx`DELETE FROM app.media_assets WHERE owner_user_id=${owner.id}`;
      await tx`DELETE FROM app.mini_app_logins WHERE session_hash IN(SELECT token_hash FROM app.organizer_sessions WHERE user_id=${owner.id})`;
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${owner.id}`;
      await tx`DELETE FROM app.analytics_traffic WHERE user_id=${owner.id}`;
      await tx`DELETE FROM app.users WHERE id=${owner.id}`;
    });
  }
  for (const id of guestIds) {
    await sql`DELETE FROM app.api_idempotency WHERE principal_key=${"guest:" + id}`;
    await sql`DELETE FROM app.guest_sessions WHERE guest_identity_id=${id}`;
    await sql`DELETE FROM app.guest_identities WHERE id=${id} AND created_at>=${started}`;
  }
  await sql.end();
  await unlink(fixturePath);
  console.info("Scoped synthetic fixture cleanup completed.");
}
