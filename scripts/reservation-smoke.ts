// Synthetic fixtures in existing staging; independent HTTP clients and PostgreSQL connections.
import nextEnv from "@next/env";
import postgres from "postgres";
import assert from "node:assert/strict";
import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { databaseTls } from "../src/server/db/tls";
nextEnv.loadEnvConfig(process.cwd());
const root = "https://family-events-staging.vercel.app",
  ref = "jjrjdogsjbdvacusvnki",
  started = new Date(),
  u = new URL(process.env.DATABASE_URL!);
if (
  (process.env.SMOKE_URL && process.env.SMOKE_URL !== root) ||
  new URL(process.env.SUPABASE_URL!).hostname !== ref + ".supabase.co" ||
  (!u.hostname.includes(ref) && !decodeURIComponent(u.username).includes(ref))
)
  throw Error("Existing staging only");
const sql = postgres(process.env.DATABASE_URL!, {
  max: 4,
  prepare: false,
  ssl: databaseTls(),
});
const tid = String(
    BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n,
  ),
  guests = new Set<string>();
let ownerId: string | undefined,
  phase = "permissions";
type Actor = { id: string; cookie: string; csrf: string };
const budgets = new Map<string, { minute: number; count: number }>();
async function request(
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
  csrf?: string,
  key = randomUUID(),
) {
  if (method !== "GET" && cookie) {
    let minute = Math.floor(Date.now() / 60000),
      b = budgets.get(cookie);
    if (b?.minute === minute && b.count >= 23) {
      const until = (minute + 1) * 60000 + 1000;
      while (Date.now() < until)
        await new Promise((r) =>
          setTimeout(r, Math.min(20000, until - Date.now())),
        );
      minute = Math.floor(Date.now() / 60000);
    }
    b = budgets.get(cookie);
    budgets.set(cookie, {
      minute,
      count: b?.minute === minute ? b.count + 1 : 1,
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
}
async function data(r: Response, status = 200) {
  assert.equal(r.status, status);
  assert(r.headers.get("cache-control")?.includes("no-store"));
  return (await r.json()).data;
}
async function login() {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id: Number(tid), first_name: "Slice07 smoke" }),
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
  const r = await request("/api/auth/telegram/mini-app", "", "POST", {
    initData: p.toString(),
  });
  assert.equal(r.status, 200);
  const profile = (await r.json()).data;
  ownerId = profile.id;
  const cookie = r.headers
    .getSetCookie()
    .find((s) => s.startsWith("__Host-fe_org="))!
    .split(";")[0];
  return {
    id: profile.id,
    cookie,
    csrf: (await data(await request("/api/auth/csrf", cookie))).csrfToken,
  };
}
async function guest() {
  const r = await request("/api/guest/session", "", "POST", {});
  assert.equal(r.status, 201);
  const full = r.headers
    .getSetCookie()
    .find((s) => s.startsWith("__Host-fe_guest="))!;
  assert(
    /HttpOnly/i.test(full) &&
      /Secure/i.test(full) &&
      /SameSite=Lax/i.test(full),
  );
  const cookie = full.split(";")[0],
    hash = createHash("sha256").update(cookie.split("=")[1]).digest();
  const [row] =
    await sql`SELECT guest_identity_id FROM app.guest_sessions WHERE token_hash=${hash}`;
  assert(row);
  guests.add(row.guest_identity_id);
  return {
    id: row.guest_identity_id,
    cookie,
    csrf: (await data(await request("/api/auth/csrf?context=guest", cookie)))
      .csrfToken,
  };
}
async function event(owner: Actor) {
  return data(
    await request(
      "/api/v1/events",
      owner.cookie,
      "POST",
      {
        title: "Slice07 reservation fixture",
        eventType: "family",
        eventDate: "2030-01-01",
        timezone: "UTC",
      },
      owner.csrf,
    ),
    201,
  );
}
async function gift(e: { id: string }, name = "Synthetic gift") {
  const [r] =
    await sql`INSERT INTO app.gifts(wishlist_id,title) SELECT id,${name} FROM app.wishlists WHERE event_id=${e.id} RETURNING id`;
  return r.id as string;
}
const path = (e: { publicId: string }, g: string) =>
  `/api/v1/public/events/${e.publicId}/gifts/${g}/reservation`;
const choose = (
  e: { publicId: string },
  g: string,
  a: Actor,
  body: unknown = {},
  key = randomUUID(),
) => request(path(e, g), a.cookie, "POST", body, a.csrf, key);
const cancel = (
  e: { publicId: string },
  g: string,
  a: Actor,
  id: string,
  key = randomUUID(),
) =>
  request(path(e, g), a.cookie, "DELETE", { reservationId: id }, a.csrf, key);
const mine = (e: { publicId: string }, a?: Actor) =>
  request(`/api/v1/public/events/${e.publicId}/my-reservations`, a?.cookie);
try {
  const [rights] =
    await sql`SELECT pg_has_role(current_user,'fe_server','member') AS server,has_function_privilege('anon','app.reserve_gift(text,uuid,uuid)','EXECUTE') AS anon,has_function_privilege('authenticated','app.cancel_reservation(text,uuid,uuid)','EXECUTE') AS authenticated`;
  assert(rights.server && !rights.anon && !rights.authenticated);
  const owner = await login(),
    e = await event(owner),
    g = await gift(e),
    a = await guest(),
    b = await guest(),
    c = await guest();
  phase = "anonymous read, name validation, CSRF and ownership boundaries";
  const before = (
    await sql`SELECT count(*)::int AS n FROM app.guest_identities`
  )[0].n;
  assert.equal((await data(await mine(e))).sessionState, "none");
  assert.equal(
    (await sql`SELECT count(*)::int AS n FROM app.guest_identities`)[0].n,
    before,
  );
  assert.equal(
    (await request(path(e, g), "", "POST", { guestName: "Anna" })).status,
    401,
  );
  assert.equal(
    (await request(path(e, g), a.cookie, "POST", { guestName: "Anna" }, "bad"))
      .status,
    403,
  );
  assert.equal((await choose(e, g, a, { guestName: "a" })).status, 422);
  assert.equal(
    (await choose(e, g, a, { guestName: "Anna", guestIdentityId: b.id }))
      .status,
    422,
  );
  assert.equal((await choose(e, g, a)).status, 422);
  phase = "create, replay, refresh and same-name isolation";
  const key = randomUUID(),
    payload = { guestName: "Synthetic Anna" },
    r = (await data(await choose(e, g, a, payload, key), 201)).reservation;
  assert.deepEqual(
    (await data(await choose(e, g, a, payload, key), 201)).reservation,
    r,
  );
  assert.equal(
    (await choose(e, g, a, { guestName: "Different" }, key)).status,
    409,
  );
  assert.equal(
    (await sql`SELECT id FROM app.rsvps WHERE event_id=${e.id}`).length,
    0,
  );
  assert.equal(
    (await data(await mine(e, a))).reservations[0].reservationId,
    r.reservationId,
  );
  const others = await data(await mine(e, b));
  assert.equal(others.reservations.length, 0);
  assert(!JSON.stringify(others).includes(r.reservationId));
  assert.equal((await choose(e, g, b, payload)).status, 409);
  assert.equal((await cancel(e, g, b, r.reservationId)).status, 404);
  const otherEvent = await event(owner);
  assert.equal((await choose(otherEvent, g, a, payload)).status, 404);
  phase = "Surprise DTO/SSR privacy and counts";
  const base = `/api/v1/events/${e.id}`,
    pub = `/api/v1/public/events/${e.publicId}`;
  for (const route of [
    base + "/wishlist",
    pub + "/wishlist",
    pub + "/gifts/" + g,
  ]) {
    const x = await data(
      await request(route, route === base + "/wishlist" ? owner.cookie : ""),
    );
    assert(!JSON.stringify(x).includes("Synthetic Anna"));
    assert(!JSON.stringify(x).includes(a.id));
    assert(!JSON.stringify(x).includes(r.reservationId));
  }
  for (const route of [
    `/e/${e.publicId}/wishlist`,
    `/e/${e.publicId}/wishlist/${g}`,
  ]) {
    const response = await request(route, a.cookie);
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const privateValue of ["Synthetic Anna", a.id, r.reservationId])
      assert(!html.includes(privateValue));
    assert(response.headers.get("x-robots-tag")?.includes("noindex"));
  }
  assert.equal(
    (await data(await request(base + "/wishlist", owner.cookie))).reservedTotal,
    1,
  );
  await data(
    await request(
      base + "/wishlist",
      owner.cookie,
      "PATCH",
      { expectedVersion: 1, hideReserverIdentity: false },
      owner.csrf,
    ),
  );
  assert.equal(
    (await data(await request(base + "/wishlist", owner.cookie))).gifts[0]
      .reserverDisplayName,
    "Synthetic Anna",
  );
  assert(
    !JSON.stringify(await data(await request(pub + "/wishlist"))).includes(
      "Synthetic Anna",
    ),
  );
  await data(
    await request(
      base + "/wishlist",
      owner.cookie,
      "PATCH",
      { expectedVersion: 2, hideReserverIdentity: true },
      owner.csrf,
    ),
  );
  phase =
    "cancel, replay, new reservation, delayed old cancellation and unchanged RSVP";
  const cancelKey = randomUUID();
  await data(await cancel(e, g, a, r.reservationId, cancelKey));
  assert.equal((await data(await mine(e, a))).reservations.length, 0);
  const freeRevision = (await data(await request(pub + "/wishlist"))).revision;
  await data(
    await request(
      pub + "/rsvp",
      a.cookie,
      "PUT",
      {
        guestName: "Synthetic RSVP",
        status: "maybe",
        adultsCount: 1,
        childrenCount: 0,
        comment: null,
        expectedVersion: null,
      },
      a.csrf,
    ),
  );
  const next = (await data(await choose(e, g, a), 201)).reservation;
  assert.notEqual(next.reservationId, r.reservationId);
  assert.equal((await data(await mine(e, a))).defaultName, "Synthetic RSVP");
  assert.equal(
    (await data(await request(pub + "/rsvp", a.cookie))).rsvp.status,
    "maybe",
  );
  await data(await cancel(e, g, a, r.reservationId, cancelKey));
  await data(await cancel(e, g, a, r.reservationId));
  assert.equal(
    (await data(await mine(e, a))).reservations[0].reservationId,
    next.reservationId,
  );
  assert.notEqual(
    (await data(await request(pub + "/wishlist"))).revision,
    freeRevision,
  );
  phase = "two independent HTTP guests reserve concurrently";
  const raceGift = await gift(e, "Race gift");
  const races = await Promise.all([
    choose(e, raceGift, b, { guestName: "Synthetic Same" }),
    choose(e, raceGift, c, { guestName: "Synthetic Same" }),
  ]);
  assert.deepEqual(races.map((x) => x.status).sort(), [201, 409]);
  const winner = races[0].status === 201 ? b : c;
  const winning = (await races.find((x) => x.status === 201)!.json()).data
    .reservation;
  assert.equal(
    (
      await sql`SELECT id FROM app.gift_reservations WHERE gift_id=${raceGift} AND status='active'`
    ).length,
    1,
  );
  phase = "reserve/cancel concurrency and next owner";
  const rc = await Promise.all([
    cancel(e, raceGift, winner, winning.reservationId),
    choose(e, raceGift, a),
  ]);
  assert.equal(rc[0].status, 200);
  assert([201, 409].includes(rc[1].status));
  if (rc[1].status === 409)
    assert.equal((await choose(e, raceGift, a)).status, 201);
  assert.equal(
    (
      await sql`SELECT id FROM app.gift_reservations WHERE gift_id=${raceGift} AND status='active'`
    ).length,
    1,
  );
  phase = "independent PostgreSQL transactions contend on the same gift";
  await sql`UPDATE app.guest_identities SET display_name='Synthetic Same' WHERE id IN(${b.id},${c.id})`;
  const dbGift = await gift(e, "DB race");
  const dbRace = await Promise.allSettled([
    sql.begin(
      async (tx) =>
        tx`SELECT * FROM app.reserve_gift(${e.publicId},${dbGift},${b.id})`,
    ),
    sql.begin(
      async (tx) =>
        tx`SELECT * FROM app.reserve_gift(${e.publicId},${dbGift},${c.id})`,
    ),
  ]);
  assert.equal(dbRace.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    dbRace.filter((x) => x.status === "rejected" && x.reason.code === "23505")
      .length,
    1,
  );
  assert.equal(
    (
      await sql`SELECT id FROM app.gift_reservations WHERE gift_id=${dbGift} AND status='active'`
    ).length,
    1,
  );
  phase = "reserve/delete Gift concurrency";
  const deleteGift = await gift(e, "Delete race");
  const dg = await Promise.all([
    choose(e, deleteGift, b),
    request(
      base + "/gifts/" + deleteGift,
      owner.cookie,
      "DELETE",
      { expectedVersion: 1, confirmReserved: true },
      owner.csrf,
    ),
  ]);
  assert([201, 404].includes(dg[0].status));
  assert.equal(dg[1].status, 200);
  assert.equal(
    (
      await sql`SELECT id FROM app.gift_reservations WHERE gift_id=${deleteGift} AND status='active'`
    ).length,
    0,
  );
  phase = "reserve/delete Event concurrency";
  const deleted = await event(owner),
    delGift = await gift(deleted);
  const de = await Promise.all([
    choose(deleted, delGift, c),
    request(
      `/api/v1/events/${deleted.id}`,
      owner.cookie,
      "DELETE",
      { expectedVersion: 1 },
      owner.csrf,
    ),
  ]);
  assert([201, 404].includes(de[0].status));
  assert.equal(de[1].status, 200);
  assert.equal(
    (
      await sql`SELECT id FROM app.gift_reservations WHERE gift_id=${delGift} AND status='active'`
    ).length,
    0,
  );
  assert.equal((await mine(deleted, c)).status, 404);
  phase =
    "session expiry/revocation and old identity cannot be recovered by name";
  await sql`UPDATE app.guest_sessions SET expires_at=now()-interval '1 second' WHERE guest_identity_id=${b.id}`;
  assert.equal((await data(await mine(e, b))).sessionState, "lost");
  assert.equal((await choose(e, g, b, payload)).status, 401);
  await sql`UPDATE app.guest_sessions SET revoked_at=now() WHERE guest_identity_id=${a.id}`;
  assert.equal((await cancel(e, g, a, next.reservationId)).status, 401);
  assert.equal((await data(await mine(e, a))).reservations.length, 0);
  assert.equal(
    (await request("/api/guest/session", a.cookie, "POST", {})).status,
    401,
  );
  const restarted = await request("/api/guest/session", a.cookie, "POST", {
    restart: true,
  });
  assert.equal(restarted.status, 201);
  const freshCookie = restarted.headers
    .getSetCookie()
    .find((x) => x.startsWith("__Host-fe_guest="))!
    .split(";")[0];
  const [fresh] =
    await sql`SELECT guest_identity_id FROM app.guest_sessions WHERE token_hash=${createHash("sha256").update(freshCookie.split("=")[1]).digest()}`;
  guests.add(fresh.guest_identity_id);
  assert.notEqual(fresh.guest_identity_id, a.id);
  assert.equal(
    (await data(await request(pub + "/my-reservations", freshCookie)))
      .reservations.length,
    0,
  );
  const analytics =
    await sql`SELECT name,guest_identity_id,user_id,properties FROM app.analytics_events WHERE event_id=${e.id} AND name IN('gift_reserved','gift_unreserved')`;
  assert.equal(analytics.length,0); // This fixture never opted into analytics.
  console.info(
    "PASS: staging actual HTTP reserve/cancel, own context, name/RSVP/session/CSRF isolation, Surprise DTO and SSR privacy, receipts and stale cancellation, independent HTTP and PostgreSQL reservation races, reserve/cancel/delete races, expiry/revocation/restart and privacy-safe analytics.",
  );
} catch {
  console.error(
    "Reservation smoke failed at: " +
      phase +
      ". Sensitive payloads suppressed.",
  );
  process.exitCode = 1;
} finally {
  await sql.begin(async (tx) => {
    if (ownerId) {
      const [owner] =
        await tx`SELECT id FROM app.users WHERE id=${ownerId} AND telegram_user_id=${tid} AND display_name='Slice07 smoke' AND created_at>=${started}`;
      if (owner) {
        await tx`DELETE FROM app.notifications WHERE subscription_id IN(SELECT s.id FROM app.notification_subscriptions s JOIN app.events e ON e.id=s.event_id WHERE e.organizer_id=${owner.id})`;
        await tx`DELETE FROM app.notification_subscriptions WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
        await tx`DELETE FROM app.analytics_events WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id}) OR user_id=${owner.id}`;
        await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"organizer:" + owner.id}`;
        await tx`DELETE FROM app.rsvps WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
        await tx`DELETE FROM app.gift_reservations WHERE gift_id IN(SELECT g.id FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id JOIN app.events e ON e.id=w.event_id WHERE e.organizer_id=${owner.id})`;
        await tx`DELETE FROM app.gifts WHERE wishlist_id IN(SELECT w.id FROM app.wishlists w JOIN app.events e ON e.id=w.event_id WHERE e.organizer_id=${owner.id})`;
        await tx`DELETE FROM app.wishlists WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
        await tx`DELETE FROM app.events WHERE organizer_id=${owner.id}`;
        await tx`DELETE FROM app.telegram_channels WHERE user_id=${owner.id}`;
        await tx`DELETE FROM app.mini_app_logins WHERE session_hash IN(SELECT token_hash FROM app.organizer_sessions WHERE user_id=${owner.id})`;
        await tx`DELETE FROM app.organizer_sessions WHERE user_id=${owner.id}`;
        await tx`DELETE FROM app.users WHERE id=${owner.id}`;
      }
    }
    for (const id of guests) {
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"guest:" + id}`;
      await tx`DELETE FROM app.guest_sessions WHERE guest_identity_id=${id}`;
      await tx`DELETE FROM app.guest_identities WHERE id=${id} AND created_at>=${started}`;
    }
  });
  await sql.end();
  console.info("Scoped synthetic fixture cleanup completed.");
}
