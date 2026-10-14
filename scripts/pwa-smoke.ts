// Existing staging only. Synthetic fixture owners, gifts, reservations and Storage files.
import nextEnv from "@next/env";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import postgres from "postgres";
import sharp from "sharp";
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
const fixturePath = `.secrets/pwa-smoke-${randomUUID()}.json`;
async function remember() {
  await mkdir(".secrets", { recursive: true, mode: 0o700 });
  await writeFile(
    fixturePath,
    JSON.stringify({
      tids,
      guestIds: [...guestIds],
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
      user: JSON.stringify({ id: Number(tid), first_name: "Slice10 smoke" }),
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
async function makeEvent(a: Actor, title: string) {
  const r = await request(
    "/api/v1/events",
    a.cookie,
    "POST",
    { title, eventType: "family", eventDate: "2030-01-01", timezone: "UTC" },
    a.csrf,
  );
  assert.equal(r.status, 201);
  return (await r.json()).data as {
    id: string;
    publicId: string;
    version: number;
  };
}
async function upload(a: Actor, bytes: Buffer, complete = true) {
  const r = await request(
    "/api/v1/media/uploads",
    a.cookie,
    "POST",
    { mimeType: "image/png", byteSize: bytes.length },
    a.csrf,
  );
  assert.equal(r.status, 201);
  const p = (await r.json()).data;
  const sent = await fetch(p.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png", "x-upsert": "false" },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(sent.status, 200);
  if (complete) {
    const c = await request(
      `/api/v1/media/${p.assetId}/complete`,
      a.cookie,
      "POST",
      undefined,
      a.csrf,
    );
    assert.equal(c.status, 200);
  }
  return p.assetId as string;
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
try {
  await remember();
  phase = "manifest, icons, worker and offline document";
  const manifestResponse = await request("/manifest.webmanifest");
  assert.equal(manifestResponse.status, 200);
  assert(
    manifestResponse.headers.get("content-type")?.includes("manifest+json"),
  );
  const app = await manifestResponse.json();
  assert.equal(app.id, "/");
  assert.equal(app.start_url, "/");
  assert.equal(app.scope, "/");
  assert.equal(app.display, "standalone");
  for (const icon of app.icons) {
    const response = await request(icon.src);
    assert.equal(response.status, 200);
    const m = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(`${m.width}x${m.height}`, icon.sizes);
  }
  assert(
    app.icons.some(
      (i: { purpose: string; src: string }) =>
        i.purpose === "maskable" && i.src.includes("maskable"),
    ),
  );
  const worker = await request("/sw.js");
  assert.equal(worker.status, 200);
  assert(worker.headers.get("cache-control")?.includes("no-store"));
  assert.equal(worker.headers.get("service-worker-allowed"), "/");
  assert((await worker.text()).includes("family-events-offline-v1"));
  const offline = await request("/offline.html");
  assert.equal(offline.status, 200);
  assert((await offline.text()).includes("Нет подключения"));
  phase =
    "three independent sessions, one verified synthetic Telegram identity";
  const owner = await login(tids[0]),
    second = await login(tids[0]),
    third = await login(tids[0]),
    foreign = await login(tids[1]);
  assert.equal(owner.id, second.id);
  assert.equal(owner.id, third.id);
  assert.notEqual(owner.cookie, second.cookie);
  assert.notEqual(second.cookie, third.cookie);
  const e = await makeEvent(owner, "Slice10 PWA happy path"),
    base = `/api/v1/events/${e.id}`,
    pub = `/api/v1/public/events/${e.publicId}`;
  const bytes = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#7e50c5" },
  })
    .png()
    .toBuffer();
  const image = await upload(owner, bytes);
  const gift = await data(
    await request(
      base + "/gifts",
      owner.cookie,
      "POST",
      {
        title: "Тестовый подарок PWA",
        imageAssetId: image,
        amount: "1500",
        currency: "RUB",
        comment: "Проверка среза 10",
      },
      owner.csrf,
    ),
    201,
  );
  phase = "canonical share, anonymous invitation and nested routes";
  const invitation = await data(await request(base + "/share", owner.cookie));
  assert.equal(invitation.publicUrl, root + `/e/${e.publicId}`);
  for (const path of [
    `/e/${e.publicId}`,
    `/e/${e.publicId}/wishlist`,
    `/e/${e.publicId}/wishlist/${gift.id}`,
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert(response.headers.get("x-robots-tag")?.includes("noindex"));
    assert(
      (await response.text()).includes(
        path.endsWith(gift.id)
          ? "Тестовый подарок PWA"
          : "Slice10 PWA happy path",
      ),
    );
  }
  for (const a of [owner, second, third]) {
    const list = await data(await request("/api/v1/events", a.cookie));
    assert(list.events.some((v: { id: string }) => v.id === e.id));
    assert.equal((await request(`/events/${e.id}`, a.cookie)).status, 200);
    assert.equal(
      (await data(await request("/api/v1/me", a.cookie))).id,
      owner.id,
    );
  }
  assert.equal((await request(base, foreign.cookie)).status, 404);
  phase =
    "RSVP, Storage image, reservation refresh and another Guest isolation";
  const a = await guest(),
    b = await guest();
  const rsvpPayload = {
    guestName: "Тестовый гость PWA",
    status: "yes",
    adultsCount: 2,
    childrenCount: 1,
    comment: "Happy path",
    expectedVersion: null,
  };
  const saved = await data(
    await request(pub + "/rsvp", a.cookie, "PUT", rsvpPayload, a.csrf),
  );
  assert.equal(
    (await data(await request(pub + "/rsvp", a.cookie))).rsvp.id,
    saved.rsvp.id,
  );
  assert.equal((await data(await request(pub + "/rsvp", b.cookie))).rsvp, null);
  const wish = await data(await request(pub + "/wishlist"));
  assert(wish.gifts[0].imageUrl);
  assert.equal((await request(wish.gifts[0].imageUrl)).status, 200);
  const reservationPath = pub + `/gifts/${gift.id}/reservation`;
  const chosen = await data(
    await request(reservationPath, a.cookie, "POST", {}, a.csrf),
    201,
  );
  assert.equal(
    (await data(await request(pub + "/my-reservations", a.cookie)))
      .reservations[0].reservationId,
    chosen.reservation.reservationId,
  );
  assert.equal(
    (await data(await request(pub + "/my-reservations", b.cookie))).reservations
      .length,
    0,
  );
  assert.equal(
    (
      await request(
        reservationPath,
        b.cookie,
        "POST",
        { guestName: "Другой гость" },
        b.csrf,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        reservationPath,
        b.cookie,
        "DELETE",
        { reservationId: chosen.reservation.reservationId },
        b.csrf,
      )
    ).status,
    404,
  );
  const ownerWishlist = await data(
    await request(base + "/wishlist", owner.cookie),
  );
  assert.equal(ownerWishlist.reservedTotal, 1);
  assert(!("reserverDisplayName" in ownerWishlist.gifts[0]));
  for (const actor of [owner, second, third]) {
    const summary = await data(await request(base + "/summary", actor.cookie));
    assert.equal(summary.responses.yes, 1);
  }
  phase = "RSVP update without duplicate and reservation cancellation";
  const updated = await data(
    await request(
      pub + "/rsvp",
      a.cookie,
      "PUT",
      { ...rsvpPayload, status: "maybe", expectedVersion: saved.rsvp.version },
      a.csrf,
    ),
  );
  assert.equal(updated.rsvp.id, saved.rsvp.id);
  await data(
    await request(
      reservationPath,
      a.cookie,
      "DELETE",
      { reservationId: chosen.reservation.reservationId },
      a.csrf,
    ),
  );
  assert.equal((await data(await request(pub + "/wishlist"))).reservedTotal, 0);
  assert.equal(
    (await data(await request(pub + "/my-reservations", a.cookie))).reservations
      .length,
    0,
  );
  assert.equal(
    (
      await sql`SELECT id FROM app.notification_subscriptions WHERE event_id=${e.id}`
    ).length,
    0,
  );
  phase = "logout isolates one session and soft delete closes invitation";
  await data(
    await request(
      "/api/auth/logout",
      second.cookie,
      "POST",
      undefined,
      second.csrf,
    ),
  );
  assert.equal((await request("/api/v1/me", second.cookie)).status, 401);
  assert.equal((await request("/api/v1/me", owner.cookie)).status, 200);
  assert.equal((await request("/api/v1/me", third.cookie)).status, 200);
  await data(
    await request(
      base,
      owner.cookie,
      "DELETE",
      { expectedVersion: e.version },
      owner.csrf,
    ),
  );
  for (const path of [
    `/e/${e.publicId}`,
    `/e/${e.publicId}/wishlist`,
    pub + "/wishlist",
  ])
    assert.equal((await request(path)).status, 404);
  console.info(
    "PASS: staging manifest/icons/worker/headers; real API Create→Storage Gift→Share URL→anonymous invitation→RSVP→Wishlist→Reservation, own refresh/isolation/cancel, Surprise, three independent server sessions for one synthetic Telegram ID, owner isolation/logout/soft delete. No real OIDC/device installation or native Share claim; no Telegram messages sent.",
  );
} catch (error) {
  const numeric =
    error instanceof assert.AssertionError &&
    typeof error.actual === "number" &&
    typeof error.expected === "number"
      ? ` Expected ${error.expected}, received ${error.actual}.`
      : "";
  console.error(
    `PWA smoke failed at ${phase}.${numeric} Secrets/payloads suppressed.`,
  );
  process.exitCode = 1;
} finally {
  for (const tid of tids) {
    const [owner] =
      await sql`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Slice10 smoke' AND created_at>=${started}`;
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
