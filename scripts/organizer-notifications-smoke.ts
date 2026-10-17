// Synthetic staging API/DB tests. Scheduler must stay paused: no Telegram delivery to fabricated identities.
import nextEnv from "@next/env";
import postgres from "postgres";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { databaseTls } from "../src/server/db/tls";
nextEnv.loadEnvConfig(process.cwd());
const root = "https://family-events-staging.vercel.app",
  ref = "jjrjdogsjbdvacusvnki",
  started = new Date(),
  adminUrl = new URL(process.env.DATABASE_URL!);
if (
  (process.env.SMOKE_URL && process.env.SMOKE_URL !== root) ||
  (!adminUrl.hostname.includes(ref) &&
    !decodeURIComponent(adminUrl.username).includes(ref))
)
  throw Error("Existing staging only");
const sql = postgres(process.env.DATABASE_URL!, {
    max: 2,
    prepare: false,
    ssl: databaseTls(),
  }),
  worker = postgres(process.env.DATABASE_WORKER_URL!, {
    max: 2,
    prepare: false,
    ssl: databaseTls(),
  });
const tids = [0, 1].map(() =>
  String(BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n),
);
const guests = new Set<string>(),
  updates = new Set<number>();
let phase = "permissions";
type Actor = { id: string; cookie: string; csrf: string };
const req = (
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
  token?: string,
  key = randomUUID(),
  extra: Record<string, string> = {},
) =>
  fetch(root + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: root,
      "Content-Type": "application/json",
      ...(token ? { "x-csrf-token": token } : {}),
      "idempotency-key": key,
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
const data = async (r: Response, status = 200) => {
  assert.equal(r.status, status);
  assert(r.headers.get("cache-control")?.includes("no-store"));
  return (await r.json()).data;
};
function init(tid: string, write?: boolean) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({
      id: Number(tid),
      first_name: "Slice08 smoke",
      ...(write === undefined ? {} : { allows_write_to_pm: write }),
    }),
  });
  const key = createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN!)
    .digest();
  p.set(
    "hash",
    createHmac("sha256", key)
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
async function login(tid: string): Promise<Actor> {
  const r = await req("/api/auth/telegram/mini-app", "", "POST", {
    initData: init(tid),
  });
  assert.equal(r.status, 200);
  const u = (await r.json()).data,
    cookie = r.headers
      .getSetCookie()
      .find((x) => x.startsWith("__Host-fe_org="))!
      .split(";")[0];
  return {
    id: u.id,
    cookie,
    csrf: (await data(await req("/api/auth/csrf", cookie))).csrfToken,
  };
}
async function makeEvent(a: Actor) {
  return data(
    await req(
      "/api/v1/events",
      a.cookie,
      "POST",
      {
        title: "Slice08 notifications fixture",
        eventType: "family",
        eventDate: "2030-01-01",
        timezone: "UTC",
      },
      a.csrf,
    ),
    201,
  );
}
async function guest(): Promise<Actor> {
  const r = await req("/api/guest/session", "", "POST", {});
  assert.equal(r.status, 201);
  const cookie = r.headers
    .getSetCookie()
    .find((x) => x.startsWith("__Host-fe_guest="))!
    .split(";")[0];
  const [g] =
    await sql`SELECT guest_identity_id FROM app.guest_sessions WHERE token_hash=${createHash("sha256").update(cookie.split("=")[1]).digest()}`;
  guests.add(g.guest_identity_id);
  return {
    id: g.guest_identity_id,
    cookie,
    csrf: (await data(await req("/api/auth/csrf?context=guest", cookie)))
      .csrfToken,
  };
}
async function update(tid: string, text: string) {
  const id = Math.floor(1000000000 + Math.random() * 1000000000);
  updates.add(id);
  const r = await req(
    "/api/telegram/webhook",
    "",
    "POST",
    {
      update_id: id,
      message: {
        date: Math.floor(Date.now() / 1000),
        from: { id: Number(tid) },
        chat: { id: Number(tid), type: "private" },
        text,
      },
    },
    undefined,
    randomUUID(),
    { "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET! },
  );
  assert.equal(r.status, 200);
  return id;
}
try {
  const [schema] =
    await sql`SELECT has_function_privilege('anon','app.claim_notifications(integer)','EXECUTE') AS anon,pg_has_role(current_user,'fe_server','member') AS server`;
  assert(!schema.anon && schema.server);
  const [queue] =
    await sql`SELECT count(*)::int AS n FROM app.notifications WHERE status IN('pending','processing')`;
  assert.equal(queue.n, 0, "Run with an empty queue and paused scheduler");
  assert.equal(
    (
      await sql`SELECT id FROM app.users WHERE telegram_user_id IN(${tids[0]},${tids[1]})`
    ).length,
    0,
  );
  const [active] =
    await sql`SELECT count(*)::int AS n FROM app.notification_subscriptions WHERE enabled AND revoked_at IS NULL`;
  assert.equal(
    active.n,
    0,
    "Synthetic tests require no active real subscriptions",
  );
  const owner = await login(tids[0]),
    other = await login(tids[1]),
    e = await makeEvent(owner),
    a = await guest();
  const base = `/api/v1/events/${e.id}`,
    settings = base + "/notification-subscription",
    handoff = base + "/notification-handoff",
    permission = base + "/notification-permission",
    rsvp = `/api/v1/public/events/${e.publicId}/rsvp`;
  phase = "owner, CSRF, permission and signed identity boundaries";
  assert.equal((await req(settings)).status, 401);
  assert.equal((await req(settings, other.cookie)).status, 404);
  assert.equal(
    (await req(settings, owner.cookie, "PUT", { enabled: true }, "bad")).status,
    403,
  );
  assert.equal(
    (await req(settings, owner.cookie, "PUT", { enabled: true }, owner.csrf))
      .status,
    409,
  );
  assert.equal(
    (
      await req(
        settings,
        owner.cookie,
        "PUT",
        { enabled: true, chatId: 1 },
        owner.csrf,
      )
    ).status,
    422,
  );
  const noPerm = {
    guestName: "Synthetic guest",
    status: "yes",
    adultsCount: 1,
    childrenCount: 1,
    comment: null,
    expectedVersion: null,
  };
  const first = await data(await req(rsvp, a.cookie, "PUT", noPerm, a.csrf));
  assert.equal(
    (
      await sql`SELECT n.id FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE s.event_id=${e.id}`
    ).length,
    0,
  );
  assert.equal(
    (await req(permission, owner.cookie, "POST", { allowed: true }, owner.csrf))
      .status,
    422,
  );
  const begin = await data(
    await req(handoff, owner.cookie, "POST", { mode: "mini_app" }, owner.csrf),
    201,
  );
  assert(begin.id && begin.telegramUrl.startsWith("https://t.me/"));
  assert.equal(
    (
      await req(
        permission,
        owner.cookie,
        "POST",
        { initData: init(tids[1], true) },
        owner.csrf,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await req(
        permission,
        owner.cookie,
        "POST",
        { initData: init(tids[0], false) },
        owner.csrf,
      )
    ).status,
    409,
  );
  const forged = new URLSearchParams(init(tids[0], false));
  const forgedUser = JSON.parse(forged.get("user")!);
  forgedUser.allows_write_to_pm = true;
  forged.set("user", JSON.stringify(forgedUser));
  assert.equal(
    (
      await req(
        permission,
        owner.cookie,
        "POST",
        { initData: forged.toString() },
        owner.csrf,
      )
    ).status,
    401,
  );
  await data(
    await req(
      permission,
      owner.cookie,
      "POST",
      { initData: init(tids[0], true) },
      owner.csrf,
    ),
  );
  assert.equal((await data(await req(settings, owner.cookie))).enabled, true);
  phase = "webhook token binding, mismatched account, replay and expiry";
  await data(
    await req(settings, owner.cookie, "PUT", { enabled: false }, owner.csrf),
  );
  const h = await data(
    await req(handoff, owner.cookie, "POST", { mode: "bot_start" }, owner.csrf),
    201,
  );
  const secret = new URL(h.telegramUrl).searchParams.get("start")!;
  await update(tids[1], "/start " + secret);
  await data(
    await req(
      "/api/internal/telegram-updates",
      "",
      "POST",
      {},
      undefined,
      randomUUID(),
      { Authorization: "Bearer " + process.env.CRON_SECRET },
    ),
  );
  assert.equal(
    (await data(await req(settings, owner.cookie))).handoff.state,
    "account_mismatch",
  );
  assert.equal((await data(await req(settings, owner.cookie))).enabled, false);
  const uid = await update(tids[0], "/start " + secret);
  await data(
    await req(
      "/api/internal/telegram-updates",
      "",
      "POST",
      {},
      undefined,
      randomUUID(),
      { Authorization: "Bearer " + process.env.CRON_SECRET },
    ),
  );
  assert.equal((await data(await req(settings, owner.cookie))).enabled, true);
  const replay = await req(
    "/api/telegram/webhook",
    "",
    "POST",
    {
      update_id: uid,
      message: {
        date: Math.floor(Date.now() / 1000),
        from: { id: Number(tids[0]) },
        chat: { id: Number(tids[0]), type: "private" },
        text: "/start " + secret,
      },
    },
    undefined,
    randomUUID(),
    { "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET! },
  );
  assert.equal(replay.status, 200);
  assert.equal(
    (
      await sql`SELECT update_id FROM app.telegram_updates WHERE update_id=${uid}`
    ).length,
    1,
  );
  phase = "atomic N2 and duplicate/no-op suppression";
  const edit = {
    ...noPerm,
    status: "no",
    adultsCount: 0,
    childrenCount: 0,
    expectedVersion: first.rsvp.version,
  };
  const key = randomUUID();
  const saved = await data(await req(rsvp, a.cookie, "PUT", edit, a.csrf, key));
  await data(await req(rsvp, a.cookie, "PUT", edit, a.csrf, key));
  await data(
    await req(
      rsvp,
      a.cookie,
      "PUT",
      { ...edit, expectedVersion: saved.rsvp.version },
      a.csrf,
    ),
  );
  let rows =
    await sql`SELECT n.id,n.type,n.payload FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE s.event_id=${e.id}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "rsvp_changed");
  assert((rows[0].payload as { text: string }).text.includes("Было: Буду"));
  assert.equal(
    (rows[0].payload as { action: { path: string } }).action.path,
    `/events/${e.id}/guests`,
  );
  phase =
    "two independent worker connections and lease guard without sending Telegram messages";
  const claimed = await Promise.all([
    worker`SELECT id,chat_id,payload,attempt,lease::text AS lease FROM app.claim_notifications(3)`,
    worker`SELECT id,chat_id,payload,attempt,lease::text AS lease FROM app.claim_notifications(3)`,
  ]);
  assert.equal(claimed.flat().length, 1);
  const job = claimed.flat()[0];
  assert.equal(
    job.id,
    rows[0].id,
    "Only the known synthetic job may be acknowledged",
  );
  phase = "exact lease acknowledgement";
  await worker`SELECT app.finish_notification(${job.id},${job.lease}::text::timestamptz,NULL,'CANCELLED',1)`;
  assert.equal(
    (await sql`SELECT status FROM app.notifications WHERE id=${job.id}`)[0]
      .status,
    "cancelled",
  );
  await worker`SELECT app.finish_notification(${job.id},now()+interval '1 hour',NULL,'403',1)`;
  assert.equal(
    (await data(await req(settings, owner.cookie))).channel,
    "ready",
  );
  phase =
    "new RSVP N1, opt-out cancels pending and re-enable does not replay history";
  const b = await guest();
  await data(
    await req(
      rsvp,
      b.cookie,
      "PUT",
      { ...noPerm, guestName: "Synthetic second" },
      b.csrf,
    ),
  );
  rows =
    await sql`SELECT n.type,n.payload FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE s.event_id=${e.id} AND n.status='pending'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "rsvp_new");
  assert.equal(
    (rows[0].payload as { action: { path: string } }).action.path,
    `/events/${e.id}`,
  );
  await data(
    await req(settings, owner.cookie, "PUT", { enabled: false }, owner.csrf),
  );
  await data(
    await req(settings, owner.cookie, "PUT", { enabled: true }, owner.csrf),
  );
  assert.equal(
    (
      await worker`SELECT id,chat_id,payload,attempt,lease::text AS lease FROM app.claim_notifications(3)`
    ).length,
    0,
  );
  phase = "expired handoff and opt-out intent cancellation";
  const expired = await data(
    await req(handoff, owner.cookie, "POST", { mode: "bot_start" }, owner.csrf),
    201,
  );
  await sql`UPDATE app.organizer_notification_handoffs SET created_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
  assert.equal(
    (await data(await req(settings, owner.cookie))).handoff.state,
    "expired",
  );
  await data(
    await req(settings, owner.cookie, "PUT", { enabled: false }, owner.csrf),
  );
  await update(
    tids[0],
    "/start " + new URL(expired.telegramUrl).searchParams.get("start"),
  );
  await data(
    await req(
      "/api/internal/telegram-updates",
      "",
      "POST",
      {},
      undefined,
      randomUUID(),
      { Authorization: "Bearer " + process.env.CRON_SECRET },
    ),
  );
  assert.equal((await data(await req(settings, owner.cookie))).enabled, false);
  assert.equal(
    (await req("/api/internal/organizer-notifications", "", "POST", {})).status,
    401,
  );
  assert.equal(
    (await req("/api/telegram/webhook", "", "POST", { update_id: 1 })).status,
    401,
  );
  console.info(
    "PASS: staging actual owner/CSRF/signed permission/forgery checks, webhook/handoff account binding/expiry/replay, N1/N2 atomic dedup/no-op, private CTA payloads, independent worker claims/stale lease and opt-out. No Telegram messages sent to synthetic users. Real permission and delivery remain a separate user-assisted test.",
  );
} catch (caught) {
  const safeCode =
    caught && typeof caught === "object" && "code" in caught
      ? String(caught.code)
      : "UNKNOWN";
  console.error(
    "Safe diagnostic code: " +
      (/^[A-Z0-9_]{1,48}$/.test(safeCode) ? safeCode : "UNKNOWN"),
  );
  if (caught instanceof assert.AssertionError)
    console.error({
      actual:
        typeof caught.actual === "number" || typeof caught.actual === "boolean"
          ? caught.actual
          : [
                "pending",
                "processing",
                "cancelled",
                "sent",
                "ready",
                "blocked",
              ].includes(String(caught.actual))
            ? caught.actual
            : "suppressed",
      expected:
        typeof caught.expected === "number" ||
        typeof caught.expected === "boolean"
          ? caught.expected
          : [
                "pending",
                "processing",
                "cancelled",
                "sent",
                "ready",
                "blocked",
              ].includes(String(caught.expected))
            ? caught.expected
            : "suppressed",
    });
  console.error(
    "Organizer notification staging smoke failed at: " +
      phase +
      ". Sensitive data suppressed.",
  );
  process.exitCode = 1;
} finally {
  await sql.begin(async (tx) => {
    for (const tid of tids) {
      const [u] =
        await tx`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Slice08 smoke' AND created_at>=${started}`;
      if (!u) continue;
      await tx`DELETE FROM app.notifications WHERE subscription_id IN(SELECT id FROM app.notification_subscriptions WHERE user_id=${u.id})`;
      await tx`DELETE FROM app.notification_subscriptions WHERE user_id=${u.id}`;
      await tx`DELETE FROM app.organizer_notification_handoffs WHERE user_id=${u.id}`;
      await tx`DELETE FROM app.analytics_events WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${u.id}) OR user_id=${u.id}`;
      await tx`DELETE FROM app.rsvps WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${u.id})`;
      await tx`DELETE FROM app.wishlists WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${u.id})`;
      await tx`DELETE FROM app.events WHERE organizer_id=${u.id}`;
      await tx`DELETE FROM app.telegram_channels WHERE user_id=${u.id}`;
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"organizer:" + u.id}`;
      await tx`DELETE FROM app.mini_app_logins WHERE session_hash IN(SELECT token_hash FROM app.organizer_sessions WHERE user_id=${u.id})`;
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${u.id}`;
      await tx`DELETE FROM app.users WHERE id=${u.id}`;
    }
    for (const g of guests) {
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"guest:" + g}`;
      await tx`DELETE FROM app.guest_sessions WHERE guest_identity_id=${g}`;
      await tx`DELETE FROM app.guest_identities WHERE id=${g} AND created_at>=${started}`;
    }
    for (const id of updates)
      await tx`DELETE FROM app.telegram_updates WHERE update_id=${id} AND created_at>=${started}`;
  });
  await Promise.all([sql.end(), worker.end()]);
  console.info("Scoped synthetic cleanup completed.");
}
