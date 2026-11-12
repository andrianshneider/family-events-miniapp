// Synthetic identities only; existing staging; scheduler must be paused. Never calls Bot API.
import nextEnv from "@next/env";
import postgres from "postgres";
import assert from "node:assert/strict";
import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { databaseTls } from "../src/server/db/tls";
nextEnv.loadEnvConfig(process.cwd());
const root = "https://family-events-staging.vercel.app",
  ref = "jjrjdogsjbdvacusvnki",
  started = new Date();
assert.equal(new URL(process.env.SUPABASE_URL!).hostname, ref + ".supabase.co");
const dbUrl = new URL(process.env.DATABASE_URL!);
assert(
  dbUrl.hostname.includes(ref) ||
    decodeURIComponent(dbUrl.username).includes(ref),
);
for (const connection of [
  process.env.DATABASE_WORKER_URL!,
  process.env.DATABASE_ADMIN_URL!,
]) {
  const target = new URL(connection);
  assert(
    target.hostname.includes(ref) ||
      decodeURIComponent(target.username).includes(ref),
  );
}
const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    ssl: databaseTls(),
  }),
  worker = postgres(process.env.DATABASE_WORKER_URL!, {
    max: 1,
    prepare: false,
    ssl: databaseTls(),
  }),
  admin = postgres(process.env.DATABASE_ADMIN_URL!, {
    max: 1,
    prepare: false,
    ssl: databaseTls(),
  });
const tids = [0, 1].map(() =>
  String(BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n),
);
const guests = new Set<string>();
let eventId = "",
  phase = "preflight";
async function req(
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
  csrf?: string,
  key = randomUUID(),
) {
  return fetch(root + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: root,
      "Content-Type": "application/json",
      "idempotency-key": key,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
}
async function data(r: Response, status = 200) {
  assert.equal(r.status, status);
  return (await r.json()).data;
}
function signed(tid: string) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id: Number(tid), first_name: "Slice09 smoke" }),
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
  return p.toString();
}
function cookie(r: Response, name: string) {
  return r.headers
    .getSetCookie()
    .find((v) => v.startsWith(name + "="))!
    .split(";")[0];
}
async function guest() {
  const r = await req("/api/guest/session", "", "POST", {});
  assert.equal(r.status, 201);
  const c = cookie(r, "__Host-fe_guest");
  const [g] =
    await sql`SELECT guest_identity_id FROM app.guest_sessions WHERE token_hash=${createHash("sha256").update(c.split("=")[1]).digest()}`;
  guests.add(g.guest_identity_id);
  return {
    cookie: c,
    id: g.guest_identity_id,
    csrf: (await data(await req("/api/auth/csrf?context=guest", c))).csrfToken,
  };
}
try {
  const [job] =
    await admin`SELECT active FROM cron.job WHERE jobname='family-events-staging-organizer-notifications'`;
  assert.equal(job.active, false);
  phase = "owner";
  const login = await req("/api/auth/telegram/mini-app", "", "POST", {
    initData: signed(tids[0]),
  });
  assert.equal(login.status, 200);
  const owner = cookie(login, "__Host-fe_org"),
    ocsrf = (await data(await req("/api/auth/csrf", owner))).csrfToken;
  const fields = {
    title: "Slice09 notification fixture",
    eventType: "family",
    eventDate: "2030-01-02",
    startTime: "15:00",
    timezone: "UTC",
  };
  const e = await data(
    await req("/api/v1/events", owner, "POST", fields, ocsrf),
    201,
  );
  eventId = e.id;
  const base = "/api/v1/public/events/" + e.publicId;
  const a = await guest();
  phase = "anonymous RSVP";
  const first = {
    guestName: "Slice09 guest",
    status: "yes",
    adultsCount: 2,
    childrenCount: 1,
    comment: null,
    expectedVersion: null,
  };
  await data(await req(base + "/rsvp", a.cookie, "PUT", first, a.csrf));
  assert.equal(
    (await data(await req(base + "/notification-subscription", a.cookie)))
      .enabled,
    false,
  );
  assert.equal(
    (await req(base + "/notification-handoff", a.cookie, "POST", {}, "bad"))
      .status,
    403,
  );
  assert.equal(
    (
      await req(
        base + "/notification-permission",
        a.cookie,
        "POST",
        { initData: "forged" },
        a.csrf,
      )
    ).status,
    401,
  );
  phase = "handoff";
  const h = await data(
    await req(base + "/notification-handoff", a.cookie, "POST", {}, a.csrf),
  );
  const repeated = await data(
    await req(base + "/notification-handoff", a.cookie, "POST", {}, a.csrf),
  );
  assert.equal(repeated.id, h.id);
  assert.equal(repeated.url, h.url);
  assert.equal(
    (await data(await req(base + "/notification-subscription", a.cookie)))
      .handoff.url,
    h.url,
  );
  const b = await guest();
  assert.equal(
    (await req(base + "/notification-handoff/" + h.id, b.cookie)).status,
    409,
  );
  const raw = h.url.split("guest_")[1];
  assert.equal(
    (
      await worker`SELECT app.verify_guest_handoff(${createHash("sha256").update(raw).digest()},${tids[1]},${tids[1]},now(),'Slice09 smoke') AS ok`
    )[0].ok,
    true,
  );
  assert.equal(
    (
      await worker`SELECT app.verify_guest_handoff(${createHash("sha256").update(raw).digest()},${tids[1]},${tids[1]},now(),'Slice09 smoke') AS ok`
    )[0].ok,
    false,
  );
  const proof = await data(
    await req(base + "/notification-handoff/" + h.id, a.cookie),
  );
  assert.equal(proof.state, "verified");
  assert.equal(
    (await data(await req(base + "/notification-subscription", a.cookie)))
      .channel,
    "ready",
  );
  const mixedCookie = a.cookie + "; " + owner;
  assert.equal(
    (await data(await req(base + "/notification-subscription", mixedCookie)))
      .accountConflict,
    true,
  );
  const blocked = await req(
    base + "/notification-complete",
    mixedCookie,
    "POST",
    { handoffId: h.id, confirmAccount: true, choices: {} },
    a.csrf,
  );
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "GUEST_ACCOUNT_CONFLICT");
  assert.equal(
    (await data(await req(base + "/notification-subscription", a.cookie)))
      .accountConflict,
    false,
  );
  const preserved = await data(
    await req(base + "/notification-handoff", a.cookie, "POST", {}, a.csrf),
  );
  assert.equal(preserved.id, h.id);
  assert.equal(preserved.url, null);
  assert.deepEqual(proof.conflicts, []);
  const complete = await req(
    base + "/notification-complete",
    a.cookie,
    "POST",
    { handoffId: h.id, confirmAccount: true, choices: {} },
    a.csrf,
  );
  await data(complete);
  a.cookie = cookie(complete, "__Host-fe_guest");
  a.csrf = (
    await data(await req("/api/auth/csrf?context=guest", a.cookie))
  ).csrfToken;
  assert.equal(
    (await data(await req(base + "/notification-subscription", a.cookie)))
      .enabled,
    true,
  );
  const [reminder] =
    await sql`SELECT n.scheduled_at::text FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE s.event_id=${e.id} AND n.type='reminder_24h'`;
  assert.equal(
    new Date(reminder.scheduled_at).toISOString(),
    "2030-01-01T15:00:00.000Z",
  );
  phase = "merge conflict";
  await data(
    await req(
      base + "/rsvp",
      b.cookie,
      "PUT",
      { ...first, guestName: "Second answer", status: "maybe" },
      b.csrf,
    ),
  );
  const bh = await data(
    await req(base + "/notification-handoff", b.cookie, "POST", {}, b.csrf),
  );
  assert.equal(
    (
      await worker`SELECT app.verify_guest_handoff(${createHash("sha256").update(bh.url.split("guest_")[1]).digest()},${tids[1]},${tids[1]},now(),'Slice09 smoke') AS ok`
    )[0].ok,
    true,
  );
  const bp = await data(
    await req(base + "/notification-handoff/" + bh.id, b.cookie),
  );
  assert.equal(bp.conflicts.length, 1);
  assert.equal(
    (
      await req(
        base + "/notification-complete",
        b.cookie,
        "POST",
        { handoffId: bh.id, confirmAccount: true, choices: {} },
        b.csrf,
      )
    ).status,
    409,
  );
  const completed = await req(
    base + "/notification-complete",
    b.cookie,
    "POST",
    {
      handoffId: bh.id,
      confirmAccount: true,
      choices: {
        [e.id]: {
          choice: "telegram",
          currentVersion: bp.conflicts[0].current_version,
          telegramVersion: bp.conflicts[0].telegram_version,
        },
      },
    },
    b.csrf,
  );
  await data(completed);
  assert.equal(
    (
      await sql`SELECT count(*)::int AS n FROM app.rsvps WHERE event_id=${e.id}`
    )[0].n,
    1,
  );
  phase = "N3 sum and dedup";
  const updated = await data(
    await req(
      "/api/v1/events/" + e.id,
      owner,
      "PATCH",
      {
        expectedVersion: 1,
        fields: {
          ...fields,
          venueName: "New venue",
          address: "New address",
          startTime: "16:00",
        },
      },
      ocsrf,
    ),
  );
  assert(updated.changeId);
  const decision =
      "/api/v1/events/" + e.id + "/changes/" + updated.changeId + "/decision",
    key = randomUUID();
  await data(
    await req(decision, owner, "POST", { decision: "send" }, ocsrf, key),
  );
  await data(
    await req(decision, owner, "POST", { decision: "send" }, ocsrf, key),
  );
  const jobs =
    await sql`SELECT n.type,n.status,n.payload FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE s.event_id=${e.id}`;
  assert.equal(jobs.filter((n) => n.type === "event_changed").length, 1);
  assert(
    jobs
      .find((n) => n.type === "event_changed")!
      .payload.text.includes("New venue"),
  );
  assert.equal(
    jobs.filter((n) => n.type === "reminder_24h" && n.status === "pending")
      .length,
    1,
  );
  assert.equal(
    jobs.filter((n) => n.type === "reminder_24h" && n.status === "cancelled")
      .length,
    1,
  );
  phase = "worker lease without delivery";
  const [otherDue] =
    await sql`SELECT count(*)::int AS n FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE s.event_id<>${e.id} AND n.status='pending' AND n.scheduled_at<=now() AND n.next_attempt_at<=now()`;
  assert.equal(otherDue.n, 0);
  const claimed =
    await worker`SELECT id,lease::text AS lease FROM app.claim_notifications(20)`;
  for (const j of claimed) {
    const [belongs] =
      await sql`SELECT n.id FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE n.id=${j.id} AND s.event_id=${e.id}`;
    if (!belongs) {
      await worker`SELECT app.finish_notification(${j.id},${j.lease}::text::timestamptz,NULL,'TEST_DEFERRED',1)`;
      continue;
    }
    assert.equal(
      (
        await worker`SELECT app.notification_deliverable(${j.id},${j.lease}::text::timestamptz) AS ok`
      )[0].ok,
      true,
    );
    await worker`SELECT app.finish_notification(${j.id},${j.lease}::text::timestamptz,NULL,'CANCELLED',1)`;
  }
  phase = "optout";
  await data(
    await req(
      base + "/notification-subscription",
      a.cookie,
      "PUT",
      { enabled: false },
      a.csrf,
    ),
  );
  assert.equal(
    (
      await sql`SELECT count(*)::int AS n FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE s.event_id=${e.id} AND n.status IN('pending','processing')`
    )[0].n,
    0,
  );
  phase = "revoked bot permission recovery";
  await worker`SELECT app.record_telegram_channel_at(${tids[1]},${tids[1]},true,now())`;
  assert.equal(
    (await data(await req(base + "/notification-subscription", a.cookie)))
      .channel,
    "blocked",
  );
  const renewed = await data(
    await req(
      base + "/notification-handoff",
      a.cookie,
      "POST",
      { restart: true },
      a.csrf,
    ),
  );
  const renewHash = createHash("sha256")
    .update(renewed.url.split("guest_")[1])
    .digest();
  assert.equal(
    (
      await worker`SELECT app.verify_guest_handoff(${renewHash},${tids[1]},${tids[1]},now(),'Slice09 smoke') AS ok`
    )[0].ok,
    true,
  );
  assert.equal(
    (await data(await req(base + "/notification-subscription", a.cookie)))
      .channel,
    "ready",
  );
  await data(
    await req(
      base + "/notification-complete",
      a.cookie,
      "POST",
      { handoffId: renewed.id, confirmAccount: true, choices: {} },
      a.csrf,
    ),
  );
  console.log(
    "PASS: real staging Guest Session/handoff/merge/N3/scheduling/lease/optout; no synthetic Bot API delivery",
  );
} catch (e) {
  console.error(
    "FAIL phase=" +
      phase +
      " code=" +
      ((e as { code?: string }).code ?? "assertion"),
  );
  process.exitCode = 1;
} finally {
  await sql.begin(async (tx) => {
    if (eventId) {
      await tx`DELETE FROM app.notifications WHERE subscription_id IN(SELECT id FROM app.notification_subscriptions WHERE event_id=${eventId})`;
      await tx`DELETE FROM app.notification_subscriptions WHERE event_id=${eventId}`;
      await tx`DELETE FROM app.auth_handoffs WHERE event_id=${eventId}`;
      await tx`DELETE FROM app.analytics_events WHERE event_id=${eventId}`;
      await tx`DELETE FROM app.rsvps WHERE event_id=${eventId}`;
      await tx`DELETE FROM app.event_changes WHERE event_id=${eventId}`;
      await tx`DELETE FROM app.wishlists WHERE event_id=${eventId}`;
      await tx`DELETE FROM app.events WHERE id=${eventId}`;
    }
    for (const g of guests) {
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"guest:" + g}`;
      await tx`DELETE FROM app.guest_sessions WHERE guest_identity_id=${g}`;
      await tx`UPDATE app.guest_identities SET merged_into_id=NULL WHERE id=${g}`;
    }
    for (const g of guests)
      await tx`DELETE FROM app.guest_identities WHERE id=${g} AND created_at>=${started}`;
    for (const tid of tids) {
      const [u] =
        await tx`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Slice09 smoke' AND created_at>=${started}`;
      if (!u) continue;
      await tx`DELETE FROM app.telegram_channels WHERE user_id=${u.id}`;
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"organizer:" + u.id}`;
      await tx`DELETE FROM app.mini_app_logins WHERE session_hash IN(SELECT token_hash FROM app.organizer_sessions WHERE user_id=${u.id})`;
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${u.id}`;
      await tx`DELETE FROM app.users WHERE id=${u.id}`;
    }
  });
  await Promise.all([sql.end(), worker.end(), admin.end()]);
  console.log("Scoped fixture cleanup complete.");
}
