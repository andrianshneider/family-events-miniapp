// Existing staging only. Synthetic identities; no Bot API delivery is invoked.
import nextEnv from "@next/env";
import postgres from "postgres";
import assert from "node:assert/strict";
import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { databaseTls } from "../src/server/db/tls";
import type { Guests } from "../src/lib/rsvp";
nextEnv.loadEnvConfig(process.cwd());
const root = "https://family-events-staging.vercel.app",
  ref = "jjrjdogsjbdvacusvnki",
  started = new Date();
const configured = new URL(process.env.DATABASE_URL!);
if (
  (process.env.SMOKE_URL && process.env.SMOKE_URL !== root) ||
  new URL(process.env.SUPABASE_URL!).hostname !== ref + ".supabase.co" ||
  !(
    configured.hostname.includes(ref) ||
    decodeURIComponent(configured.username).includes(ref)
  )
)
  throw Error("Existing staging only");
const sql = postgres(process.env.DATABASE_URL!, {
  max: 1,
  prepare: false,
  ssl: databaseTls(),
});
type Actor = { cookie: string; csrf: string; id: string };
type Guest = { cookie: string; csrf: string; identityId: string };
const tids = [0, 1].map(() =>
  String(BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n),
);
const actors: Actor[] = [],
  guestIds = new Set<string>(),
  events: string[] = [];
let phase = "login";
const request = (
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
  csrf?: string,
  key?: string,
) =>
  fetch(root + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: root,
      "Content-Type": "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
async function actor(tid: string) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id: Number(tid), first_name: "Slice05 smoke" }),
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
  const response = await request("/api/auth/telegram/mini-app", "", "POST", {
    initData: p.toString(),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .find((v) => v.startsWith("__Host-fe_org="))!
    .split(";")[0];
  const profile = (await response.json()).data;
  const csrf = (await (await request("/api/auth/csrf", cookie)).json()).data
    .csrfToken;
  return { cookie, csrf, id: profile.id } as Actor;
}
async function makeEvent(owner: Actor, title: string) {
  const response = await request(
    "/api/v1/events",
    owner.cookie,
    "POST",
    { title, eventType: "family", eventDate: "2030-01-01", timezone: "UTC" },
    owner.csrf,
    randomUUID(),
  );
  assert.equal(response.status, 201);
  const event = (await response.json()).data;
  events.push(event.id);
  return event as { id: string; publicId: string };
}
async function bootstrap(cookie = "", restart = false) {
  const response = await request(
    "/api/guest/session",
    cookie,
    "POST",
    restart ? { restart: true } : {},
  );
  assert.equal(response.status, cookie && !restart ? 200 : 201);
  const raw = response.headers
    .getSetCookie()
    .find((v) => v.startsWith("__Host-fe_guest="));
  const guestCookie = raw ? raw.split(";")[0] : cookie;
  if (raw) {
    assert(
      /HttpOnly/i.test(raw) &&
        /Secure/i.test(raw) &&
        /SameSite=Lax/i.test(raw) &&
        /Max-Age=15552000/i.test(raw),
    );
    assert(!raw.includes("Domain="));
  }
  const hash = createHash("sha256").update(guestCookie.split("=")[1]).digest();
  const [record] =
    await sql`SELECT g.id FROM app.guest_sessions s JOIN app.guest_identities g ON g.id=s.guest_identity_id WHERE s.token_hash=${hash} AND s.created_at>=${started}`;
  assert(record);
  guestIds.add(record.id);
  const csrf = (
    await (await request("/api/auth/csrf?context=guest", guestCookie)).json()
  ).data.csrfToken;
  return { cookie: guestCookie, csrf, identityId: record.id } as Guest;
}
const put = (
  event: { publicId: string },
  guest: Guest,
  body: unknown,
  key = randomUUID(),
) =>
  request(
    `/api/v1/public/events/${event.publicId}/rsvp`,
    guest.cookie,
    "PUT",
    body,
    guest.csrf,
    key,
  );
const context = (event: { publicId: string }, cookie = "") =>
  request(`/api/v1/public/events/${event.publicId}/my-context`, cookie);
try {
  const [role] =
    await sql`SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'fe_server','member') AS server FROM pg_roles WHERE rolname=current_user`;
  assert(!role.rolsuper && !role.rolbypassrls && role.server);
  actors.push(await actor(tids[0]), await actor(tids[1]));
  const [owner, other] = actors;
  const event = await makeEvent(owner, "Slice05 RSVP fixture");
  const empty = await context(event);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.getSetCookie().length, 0);
  assert.equal((await empty.json()).data.sessionState, "none");
  phase = "guest bootstrap, reuse, csrf and validation";
  const a = await bootstrap();
  assert.equal((await bootstrap(a.cookie)).identityId, a.identityId);
  const first = {
    guestName: "Одинаковое имя",
    status: "yes",
    adultsCount: 2,
    childrenCount: 1,
    comment: "Комментарий\nсо второй строкой",
    expectedVersion: null,
  };
  assert.equal(
    (
      await request(
        `/api/v1/public/events/${event.publicId}/rsvp`,
        "",
        "PUT",
        first,
      )
    ).status,
    401,
  );
  assert.equal(
    (await put(event, { ...a, csrf: owner.csrf }, first)).status,
    403,
  );
  for (const fields of [
    { guestName: "😊" },
    { adultsCount: 0 },
    { childrenCount: 21 },
    { adultsCount: 1.5 },
    { guestIdentityId: a.identityId },
    { status: "no", adultsCount: 1 },
  ])
    assert.equal((await put(event, a, { ...first, ...fields })).status, 422);
  phase = "atomic new rsvp and outbox";
  await sql`INSERT INTO app.telegram_channels(user_id,chat_id,permission_granted_at,permission_source,delivery_state) VALUES(${owner.id},${tids[0]},now(),'bot_start','ready')`;
  const [sub] =
    await sql`INSERT INTO app.notification_subscriptions(event_id,user_id,role,enabled,consented_at) VALUES(${event.id},${owner.id},'organizer',true,now()) RETURNING id`;
  const key = randomUUID();
  const saved = await put(event, a, first, key);
  assert.equal(saved.status, 200);
  const rsvp = (await saved.json()).data.rsvp;
  assert.equal(rsvp.version, 1);
  const [created] =
    await sql`SELECT created_at FROM app.rsvps WHERE id=${rsvp.id}`;
  assert.deepEqual(
    (await (await put(event, a, first, key)).json()).data.rsvp,
    rsvp,
  );
  assert.equal((await put(event, a, first)).status, 409);
  assert.equal(
    (await put(event, a, { ...first, status: "maybe" }, key)).status,
    409,
  );
  const noop = (
    await (await put(event, a, { ...first, expectedVersion: 1 })).json()
  ).data;
  assert.equal(noop.changed, false);
  assert.equal(noop.rsvp.version, 1);
  assert.equal(
    (
      await sql`SELECT count(*)::int AS count FROM app.notifications WHERE subscription_id=${sub.id}`
    )[0].count,
    1,
  );
  assert.equal(
    (
      await sql`SELECT trigger_key FROM app.notifications WHERE subscription_id=${sub.id}`
    )[0].trigger_key,
    `rsvp:${rsvp.id}:v1`,
  );
  const restored = (await (await context(event, a.cookie)).json()).data;
  assert.equal(restored.rsvp.id, rsvp.id);
  assert.equal(restored.rsvp.comment, first.comment);
  const b = await bootstrap();
  assert.notEqual(a.identityId, b.identityId);
  assert.equal((await (await context(event, b.cookie)).json()).data.rsvp, null);
  const bResponse = await put(event, b, {
    ...first,
    status: "maybe",
    adultsCount: 3,
    childrenCount: 2,
  });
  assert.equal(bResponse.status, 200);
  const bRsvp = (await bResponse.json()).data.rsvp;
  assert.notEqual(bRsvp.id, rsvp.id);
  phase = "owner list, totals, private projection and delayed refresh";
  const listPath = `/api/v1/events/${event.id}/guests`,
    summaryPath = `/api/v1/events/${event.id}/summary`;
  assert.equal((await request(listPath, a.cookie)).status, 401);
  assert.equal((await request(listPath, other.cookie)).status, 404);
  assert.equal((await request(summaryPath, other.cookie)).status, 404);
  const initial = (
    await (await request(listPath + "?limit=1", owner.cookie)).json()
  ).data;
  assert.deepEqual(initial.summary, {
    responses: { yes: 1, no: 0, maybe: 1, total: 2 },
    confirmed: { adults: 2, children: 1 },
  });
  assert(initial.nextCursor);
  assert.equal(
    (
      await (
        await request(
          listPath + "?limit=1&cursor=" + initial.nextCursor,
          owner.cookie,
        )
      ).json()
    ).data.guests.length,
    1,
  );
  assert.equal(
    (
      await request(
        listPath + "?status=no&cursor=" + initial.nextCursor,
        owner.cookie,
      )
    ).status,
    422,
  );
  assert.deepEqual(
    Object.keys(initial.guests[0]).sort(),
    [
      "id",
      "guestName",
      "status",
      "adultsCount",
      "childrenCount",
      "comment",
      "version",
      "updatedAt",
    ].sort(),
  );
  const page = await request(`/events/${event.id}/guests`, owner.cookie);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes("Список гостей") && html.includes(first.guestName));
  assert(!html.includes(a.identityId) && !html.includes(b.identityId));
  const foreignHtml = await (
    await request(`/events/${event.id}/guests`, other.cookie)
  ).text();
  assert(
    foreignHtml.includes("Событие недоступно") &&
      !foreignHtml.includes(first.guestName),
  );
  const changed = {
    ...first,
    status: "no",
    adultsCount: 0,
    childrenCount: 0,
    expectedVersion: 1,
  };
  const editKey = randomUUID();
  const edit = (await (await put(event, a, changed, editKey)).json()).data.rsvp;
  assert.equal(edit.id, rsvp.id);
  assert.equal(edit.version, 2);
  assert.equal(
    (
      await sql`SELECT created_at FROM app.rsvps WHERE id=${edit.id}`
    )[0].created_at.getTime(),
    created.created_at.getTime(),
  );
  assert.equal(
    (await (await put(event, a, changed, editKey)).json()).data.rsvp.version,
    2,
  );
  const totals = (await (await request(summaryPath, owner.cookie)).json()).data;
  assert.deepEqual(totals, {
    responses: { yes: 0, no: 1, maybe: 1, total: 2 },
    confirmed: { adults: 0, children: 0 },
  });
  assert.equal(
    (
      await sql`SELECT count(*)::int AS count FROM app.notifications WHERE subscription_id=${sub.id}`
    )[0].count,
    3,
  ); // N1 per guest + N2 once.
  const seenAt = Date.now();
  const changedB = {
    ...first,
    status: "yes",
    adultsCount: 4,
    childrenCount: 2,
    expectedVersion: bRsvp.version,
  };
  assert.equal((await put(event, b, changedB)).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const refreshed = (await (await request(summaryPath, owner.cookie)).json())
    .data;
  assert.deepEqual(refreshed.confirmed, { adults: 4, children: 2 });
  assert(Date.now() - seenAt < 10000);
  const management = (
    await (await request(`/api/v1/events/${event.id}`, owner.cookie)).json()
  ).data;
  assert.equal(management.latestResponses.length, 2);
  assert.deepEqual(
    {
      adults: management.responses.adults,
      children: management.responses.children,
    },
    refreshed.confirmed,
  );
  phase = "actual concurrent create and edit, idempotency";
  const c = await bootstrap();
  const concurrentKey = randomUUID();
  const createPair = await Promise.all([
    put(event, c, { ...first, guestName: "Параллельный гость" }, concurrentKey),
    put(event, c, { ...first, guestName: "Параллельный гость" }, concurrentKey),
  ]);
  assert(createPair.every((response) => response.status === 200));
  assert.deepEqual(
    (await createPair[0].json()).data,
    (await createPair[1].json()).data,
  );
  const latestA = (await (await context(event, a.cookie)).json()).data.rsvp;
  const editPair = await Promise.all([
    put(event, a, {
      ...first,
      comment: "Изменение A",
      expectedVersion: latestA.version,
    }),
    put(event, a, {
      ...first,
      comment: "Изменение B",
      expectedVersion: latestA.version,
    }),
  ]);
  assert.deepEqual(
    editPair.map((response) => response.status).sort(),
    [200, 409],
  );
  phase =
    "paging all responses including microseconds and filter-independent totals";
  const pagingEvent = await makeEvent(owner, "Slice05 paging fixture");
  for (let i = 0; i < 23; i++) {
    const [identity] =
      await sql`INSERT INTO app.guest_identities(display_name) VALUES(${"Paging " + i}) RETURNING id`;
    guestIds.add(identity.id);
    await sql`INSERT INTO app.rsvps(event_id,guest_identity_id,guest_name,status,adults_count,children_count,created_at) VALUES(${pagingEvent.id},${identity.id},${"Paging " + i},${i % 2 ? "no" : "yes"},${i % 2 ? 0 : 1},0,${"2026-10-12T00:00:00." + String(123400 + i) + "Z"})`;
  }
  let cursor: string | null = null;
  const reached = new Set<string>();
  do {
    const url: string = `/api/v1/events/${pagingEvent.id}/guests?limit=7${cursor ? "&cursor=" + cursor : ""}`;
    const data: Guests = (await (await request(url, owner.cookie)).json()).data;
    assert.equal(data.summary.responses.total, 23);
    for (const r of data.guests) {
      assert(!reached.has(r.id));
      reached.add(r.id);
    }
    cursor = data.nextCursor;
  } while (cursor);
  assert.equal(reached.size, 23);
  const noFilter = (
    await (
      await request(
        `/api/v1/events/${pagingEvent.id}/guests?status=no`,
        owner.cookie,
      )
    ).json()
  ).data;
  assert.equal(noFilter.summary.responses.total, 23);
  assert.equal(noFilter.guests.length, 11);
  phase = "public privacy and lost session explicit restart";
  const publicHtml = await (
    await request(`/e/${event.publicId}`, a.cookie)
  ).text();
  assert(
    !publicHtml.includes(first.guestName) &&
      !publicHtml.includes(first.comment) &&
      !publicHtml.includes(a.identityId),
  );
  assert(publicHtml.includes("Загружаем ваш ответ"));
  await sql`UPDATE app.guest_sessions SET revoked_at=now() WHERE token_hash=${createHash("sha256").update(a.cookie.split("=")[1]).digest()}`;
  assert.equal(
    (await (await context(event, a.cookie)).json()).data.sessionState,
    "lost",
  );
  assert.equal(
    (await put(event, a, { ...first, expectedVersion: 3 })).status,
    401,
  );
  assert.equal(
    (await request("/api/guest/session", a.cookie, "POST", {})).status,
    401,
  );
  const restarted = await bootstrap(a.cookie, true);
  assert.notEqual(restarted.identityId, a.identityId);
  assert.equal(
    (await (await context(event, restarted.cookie)).json()).data.rsvp,
    null,
  );
  await sql`UPDATE app.guest_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 second' WHERE token_hash=${createHash("sha256").update(restarted.cookie.split("=")[1]).digest()}`;
  assert.equal(
    (await (await context(event, restarted.cookie)).json()).data.sessionState,
    "lost",
  );
  assert.equal((await put(event, restarted, first)).status, 401);
  assert.equal(
    (await request("/api/guest/session", restarted.cookie, "POST", {})).status,
    401,
  );
  phase = "actual RSVP/delete concurrency and unavailable routes";
  const race = await makeEvent(owner, "Slice05 deletion race");
  const pair = await Promise.all([
    put(race, c, first),
    request(
      `/api/v1/events/${race.id}`,
      owner.cookie,
      "DELETE",
      { expectedVersion: 1 },
      owner.csrf,
      randomUUID(),
    ),
  ]);
  assert.equal(pair[1].status, 200);
  assert([200, 404].includes(pair[0].status));
  assert.equal((await context(race, c.cookie)).status, 404);
  assert.equal((await put(race, c, first)).status, 404);
  assert.equal(
    (await request(`/api/v1/events/${race.id}/guests`, owner.cookie)).status,
    404,
  );
  assert.equal(
    (await request(`/api/v1/events/${race.id}/summary`, owner.cookie)).status,
    404,
  );
  console.info(
    "PASS: staging Guest Session hash/cookie/reuse, own context, real yes/no/maybe RSVP insert/update/noop, identity isolation, CSRF, validation, N1/N2 atomic dedupe, owner Guest List/summary, 5s polling contract from independent client requests, actual parallel RSVP create/edit/delete, complete microsecond pagination, public privacy and explicit lost-session restart. Device interactions remain manual.",
  );
} catch {
  console.error(
    "RSVP staging smoke failed at: " +
      phase +
      ". Credentials and personal payloads suppressed.",
  );
  process.exitCode = 1;
} finally {
  await sql.begin(async (tx) => {
    for (const tid of tids) {
      const [owner] =
        await tx`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Slice05 smoke' AND created_at>=${started}`;
      if (!owner) continue;
      await tx`DELETE FROM app.notifications WHERE subscription_id IN(SELECT s.id FROM app.notification_subscriptions s JOIN app.events e ON e.id=s.event_id WHERE e.organizer_id=${owner.id})`;
      await tx`DELETE FROM app.notification_subscriptions WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
      await tx`DELETE FROM app.analytics_events WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id}) OR user_id=${owner.id}`;
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"organizer:" + owner.id}`;
      await tx`DELETE FROM app.rsvps WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
      await tx`DELETE FROM app.wishlists WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
      await tx`DELETE FROM app.events WHERE organizer_id=${owner.id}`;
      await tx`DELETE FROM app.telegram_channels WHERE user_id=${owner.id}`;
      await tx`DELETE FROM app.mini_app_logins WHERE session_hash IN(SELECT token_hash FROM app.organizer_sessions WHERE user_id=${owner.id})`;
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${owner.id}`;
      await tx`DELETE FROM app.users WHERE id=${owner.id}`;
    }
    for (const id of guestIds) {
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"guest:" + id}`;
      await tx`DELETE FROM app.guest_sessions WHERE guest_identity_id=${id}`;
      await tx`DELETE FROM app.guest_identities WHERE id=${id} AND created_at>=${started}`;
    }
  });
  await sql.end();
}
