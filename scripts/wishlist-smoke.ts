// Existing staging only. Synthetic fixture owners, gifts, reservations and Storage files.
import nextEnv from "@next/env";
import postgres from "postgres";
import sharp from "sharp";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { databaseTls } from "../src/server/db/tls";
import type { Wishlist } from "../src/lib/wishlist";
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
      user: JSON.stringify({ id: Number(tid), first_name: "Slice06 smoke" }),
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
try {
  assert.equal((await sql`SELECT current_user AS role`)[0].role, "fe_server");
  const owner = await login(tids[0]),
    foreign = await login(tids[1]),
    e = await makeEvent(owner, "Slice06 wishlist fixture"),
    other = await makeEvent(foreign, "Slice06 foreign fixture"),
    base = `/api/v1/events/${e.id}`,
    pub = `/api/v1/public/events/${e.publicId}`;
  const get = async (path: string, cookie = "") => {
    const r = await request(path, cookie);
    assert.equal(r.status, 200);
    return (await r.json()).data;
  };
  phase = "empty wishlist and anonymous SSR without guest creation";
  assert.equal(
    (await sql`SELECT id FROM app.wishlists WHERE event_id=${e.id}`).length,
    1,
  );
  const empty = await get(pub + "/wishlist");
  assert.equal(empty.total, 0);
  assert.equal(
    (await get(base + "/wishlist", owner.cookie)).hideReserverIdentity,
    true,
  );
  const [before] =
    await sql`SELECT count(*)::int AS count FROM app.guest_identities`;
  for (const path of [`/e/${e.publicId}/wishlist`, `/e/${e.publicId}`]) {
    const r = await request(path);
    assert.equal(r.status, 200);
    assert(
      !r.headers.getSetCookie().some((v) => v.startsWith("__Host-fe_guest=")),
    );
    assert(r.headers.get("x-robots-tag")?.includes("noindex"));
    assert((await r.text()).includes("Wishlist пока пуст"));
  }
  assert.equal(
    (await sql`SELECT count(*)::int AS count FROM app.guest_identities`)[0]
      .count,
    before.count,
  );
  assert.equal(
    (await request(base + "/gifts", "", "POST", { title: "No auth" })).status,
    401,
  );
  assert.equal(
    (
      await request(
        base + "/gifts",
        owner.cookie,
        "POST",
        { title: "Bad CSRF" },
        foreign.csrf,
      )
    ).status,
    403,
  );
  for (const invalid of [
    { title: "a" },
    { title: "Gift", amount: "0", currency: "RUB" },
    { title: "Gift", amount: "1.001", currency: "RUB" },
    { title: "Gift", currency: "USD" },
    { title: "Gift", externalUrl: "javascript:alert(1)" },
    { title: "Gift", comment: "x".repeat(301) },
    { title: "Gift", guestIdentityId: randomUUID() },
  ])
    assert.equal(
      (
        await request(
          base + "/gifts",
          owner.cookie,
          "POST",
          invalid,
          owner.csrf,
        )
      ).status,
      422,
    );
  phase = "minimal/full gifts, real Storage, idempotency and optimistic edit";
  const k = randomUUID(),
    minimal = { title: "Минимальный подарок" };
  let r = await request(
    base + "/gifts",
    owner.cookie,
    "POST",
    minimal,
    owner.csrf,
    k,
  );
  assert.equal(r.status, 201);
  const g = (await r.json()).data;
  assert.deepEqual(
    (
      await (
        await request(
          base + "/gifts",
          owner.cookie,
          "POST",
          minimal,
          owner.csrf,
          k,
        )
      ).json()
    ).data,
    g,
  );
  assert.equal(
    (
      await request(
        base + "/gifts",
        owner.cookie,
        "POST",
        { title: "Changed" },
        owner.csrf,
        k,
      )
    ).status,
    409,
  );
  const png = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "purple" },
    })
      .png()
      .toBuffer(),
    imageId = await upload(owner, png),
    foreignId = await upload(foreign, png),
    pendingId = await upload(owner, png, false);
  for (const id of [foreignId, pendingId])
    assert.equal(
      (
        await request(
          base + "/gifts",
          owner.cookie,
          "POST",
          { title: "Invalid image", imageAssetId: id },
          owner.csrf,
        )
      ).status,
      422,
    );
  const fields = {
    title: "Полный подарок 😊",
    amount: "9999999999.99",
    currency: "EUR",
    externalUrl: "https://example.com/item",
    comment: "Описание подарка\nВторая строка",
    imageAssetId: imageId,
  };
  r = await request(base + "/gifts", owner.cookie, "POST", fields, owner.csrf);
  assert.equal(r.status, 201);
  const full = (await r.json()).data,
    fullPath = base + `/gifts/${full.id}`,
    publicPath = pub + `/gifts/${full.id}`;
  const detail = await get(publicPath);
  assert.equal(detail.amount, "9999999999.99");
  assert.equal(detail.comment, fields.comment);
  assert.equal(detail.externalUrl, fields.externalUrl);
  assert(!("imageAssetId" in detail));
  const img = await request(publicPath + "/image");
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/webp");
  const metadata = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
  assert(metadata.width! <= 640);
  assert(!metadata.exif);
  assert.equal(
    (
      await request(
        `/api/v1/public/events/${other.publicId}/gifts/${full.id}/image`,
      )
    ).status,
    404,
  );
  assert.equal((await request(fullPath, foreign.cookie)).status, 404);
  assert.equal((await request(base + "/wishlist", foreign.cookie)).status, 404);
  assert.equal(
    (
      await request(
        base + "/gifts",
        foreign.cookie,
        "POST",
        { title: "Foreign" },
        foreign.csrf,
      )
    ).status,
    404,
  );
  const editKey = randomUUID(),
    edited = {
      ...fields,
      title: "Обновлённый подарок",
      amount: "100.25",
      currency: "USD",
    },
    editBody = { expectedVersion: 1, fields: edited };
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        editBody,
        owner.csrf,
        editKey,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        editBody,
        owner.csrf,
        editKey,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        { expectedVersion: 1, fields: { title: "Stale" } },
        owner.csrf,
      )
    ).status,
    409,
  );
  assert.equal((await get(publicPath)).title, edited.title);
  assert.equal((await get(fullPath, owner.cookie)).version, 2);
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        { expectedVersion: 2, fields: edited },
        owner.csrf,
      )
    ).status,
    200,
  );
  assert.equal((await get(fullPath, owner.cookie)).version, 2);
  // Failed replacement preserves the old attached asset; later valid replacement/removal persist.
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        { expectedVersion: 2, fields: { ...edited, imageAssetId: pendingId } },
        owner.csrf,
      )
    ).status,
    422,
  );
  assert.equal((await get(fullPath, owner.cookie)).imageAssetId, imageId);
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        { expectedVersion: 2, fields: { ...edited, imageAssetId: null } },
        owner.csrf,
      )
    ).status,
    200,
  );
  assert.equal((await get(publicPath)).imageUrl, null);
  assert.equal((await request(publicPath + "/image")).status, 404);
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        { expectedVersion: 3, fields: { ...edited, imageAssetId: pendingId } },
        owner.csrf,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        `/api/v1/media/${pendingId}/complete`,
        owner.cookie,
        "POST",
        undefined,
        owner.csrf,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/v1/media/${pendingId}/complete`,
        owner.cookie,
        "POST",
        undefined,
        owner.csrf,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        { expectedVersion: 3, fields: { ...edited, imageAssetId: pendingId } },
        owner.csrf,
      )
    ).status,
    200,
  );
  assert.equal((await request(publicPath + "/image")).status, 200);
  phase = "invalid upload contents and image size/pixel limits";
  assert.equal(
    (
      await request(
        "/api/v1/media/uploads",
        owner.cookie,
        "POST",
        { mimeType: "image/svg+xml", byteSize: 100 },
        owner.csrf,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await request(
        "/api/v1/media/uploads",
        owner.cookie,
        "POST",
        { mimeType: "image/png", byteSize: 10485761 },
        owner.csrf,
      )
    ).status,
    422,
  );
  for (const bytes of [
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    ),
    await sharp({
      create: { width: 5010, height: 4000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer(),
  ]) {
    const id = await upload(owner, bytes, false);
    assert.equal(
      (
        await request(
          `/api/v1/media/${id}/complete`,
          owner.cookie,
          "POST",
          undefined,
          owner.csrf,
        )
      ).status,
      422,
    );
  }
  phase =
    "Surprise projections, confirmed deletion and real reservation preservation";
  const [guest] =
    await sql`INSERT INTO app.guest_identities(display_name) VALUES('Slice06 private reserver') RETURNING id`;
  guestIds.add(guest.id);
  await sql`SELECT app.reserve_gift(${e.publicId},${full.id},${guest.id})`;
  const hidden = await get(base + "/wishlist", owner.cookie);
  assert.equal(hidden.reservedTotal, 1);
  assert(!JSON.stringify(hidden).includes("Slice06 private reserver"));
  assert(
    !(
      "reserverDisplayName" in
      hidden.gifts.find((v: { id: string }) => v.id === full.id)
    ),
  );
  const offKey = randomUUID(),
    off = { hideReserverIdentity: false, expectedVersion: hidden.version };
  assert.equal(
    (
      await request(
        base + "/wishlist",
        owner.cookie,
        "PATCH",
        off,
        owner.csrf,
        offKey,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        base + "/wishlist",
        owner.cookie,
        "PATCH",
        off,
        owner.csrf,
        offKey,
      )
    ).status,
    200,
  );
  assert.equal(
    (await get(fullPath, owner.cookie)).reserverDisplayName,
    "Slice06 private reserver",
  );
  const visible = await get(base + "/wishlist", owner.cookie);
  assert.equal(
    (
      await request(
        base + "/wishlist",
        owner.cookie,
        "PATCH",
        { hideReserverIdentity: true, expectedVersion: hidden.version },
        owner.csrf,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        base + "/wishlist",
        owner.cookie,
        "PATCH",
        { hideReserverIdentity: true, expectedVersion: visible.version },
        owner.csrf,
      )
    ).status,
    200,
  );
  assert(
    !JSON.stringify(await get(fullPath, owner.cookie)).includes(
      "Slice06 private reserver",
    ),
  );
  for (const path of [pub + "/wishlist", publicPath]) {
    const dto = await get(path);
    assert(!JSON.stringify(dto).includes("Slice06 private reserver"));
    assert(!JSON.stringify(dto).includes(guest.id));
  }
  for (const path of [
    `/e/${e.publicId}/wishlist`,
    `/e/${e.publicId}/wishlist/${full.id}`,
    `/e/${e.publicId}`,
  ]) {
    const rr = await request(path);
    assert.equal(rr.status, 200);
    const html = await rr.text();
    assert(
      !html.includes("Slice06 private reserver") && !html.includes(guest.id),
    );
    assert(html.includes(edited.title));
    assert(!html.includes("Отменить выбор"));
  }
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "PATCH",
        {
          expectedVersion: 4,
          fields: {
            ...edited,
            comment: "Изменение без отмены брони",
            imageAssetId: pendingId,
          },
        },
        owner.csrf,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await sql`SELECT id FROM app.gift_reservations WHERE gift_id=${full.id} AND status='active'`
    ).length,
    1,
  );
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "DELETE",
        { expectedVersion: 5 },
        owner.csrf,
      )
    ).status,
    409,
  );
  const deleteKey = randomUUID(),
    del = { expectedVersion: 5, confirmReserved: true };
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "DELETE",
        del,
        owner.csrf,
        deleteKey,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        fullPath,
        owner.cookie,
        "DELETE",
        del,
        owner.csrf,
        deleteKey,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await sql`SELECT cancel_reason FROM app.gift_reservations WHERE gift_id=${full.id}`
    )[0].cancel_reason,
    "gift_deleted",
  );
  for (const path of [
    publicPath,
    publicPath + "/image",
    fullPath,
    fullPath + "/image",
    `/api/v1/media/${pendingId}`,
  ])
    assert.equal((await request(path, owner.cookie)).status, 404);
  const shared = await request(
    base + "/gifts",
    owner.cookie,
    "POST",
    { title: "Общее изображение", imageAssetId: pendingId },
    owner.csrf,
  );
  assert.equal(shared.status, 201);
  assert.equal(
    (await request(`/api/v1/media/${pendingId}`, owner.cookie)).status,
    200,
  ); // follows owner-only signed redirect
  phase = "real parallel edits, complete cursor pages and deletion races";
  const gpath = base + `/gifts/${g.id}`;
  const changes = await Promise.all(
    ["A", "B"].map((title) =>
      request(
        gpath,
        owner.cookie,
        "PATCH",
        { expectedVersion: 1, fields: { title: "Параллельный " + title } },
        owner.csrf,
      ),
    ),
  );
  assert.deepEqual(changes.map((v) => v.status).sort(), [200, 409]);
  for (let n = 0; n < 23; n++)
    await sql`INSERT INTO app.gifts(wishlist_id,title,created_at) VALUES((SELECT id FROM app.wishlists WHERE event_id=${e.id}),${"Pagination " + n},${"2026-10-12T00:00:00." + String(123400 + n) + "Z"})`;
  let cursor: string | null = null;
  const reached = new Set<string>();
  do {
    const path: string =
      pub + "/wishlist?limit=7" + (cursor ? "&cursor=" + cursor : "");
    const page: Wishlist = await get(path);
    assert.equal(page.total, 25);
    for (const gift of page.gifts) {
      assert(!reached.has(gift.id));
      reached.add(gift.id);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(reached.size, 25);
  const initialPage = await get(pub + "/wishlist?limit=1");
  assert.equal(
    (
      await request(
        `/api/v1/public/events/${other.publicId}/wishlist?cursor=${initialPage.nextCursor}`,
      )
    ).status,
    422,
  );
  const race = await makeEvent(owner, "Slice06 race fixture"),
    raceBase = `/api/v1/events/${race.id}`;
  const raceCreate = await request(
    raceBase + "/gifts",
    owner.cookie,
    "POST",
    { title: "Race Gift" },
    owner.csrf,
  );
  assert.equal(raceCreate.status, 201);
  const raceG = (await raceCreate.json()).data;
  const pair = await Promise.all([
    sql`SELECT * FROM app.reserve_gift(${race.publicId},${raceG.id},${guest.id})`.then(
      () => "reserved",
      () => "unavailable",
    ),
    request(
      raceBase + `/gifts/${raceG.id}`,
      owner.cookie,
      "DELETE",
      { expectedVersion: 1, confirmReserved: true },
      owner.csrf,
    ),
  ]);
  assert.equal((pair[1] as Response).status, 200);
  assert.equal(
    (
      await sql`SELECT id FROM app.gift_reservations WHERE gift_id=${raceG.id} AND status='active'`
    ).length,
    0,
  );
  const [version] = await sql`SELECT version FROM app.events WHERE id=${e.id}`;
  assert.equal(
    (
      await request(
        base,
        owner.cookie,
        "DELETE",
        { expectedVersion: version.version },
        owner.csrf,
      )
    ).status,
    200,
  );
  for (const path of [
    base + "/wishlist",
    pub + "/wishlist",
    publicPath,
    `/e/${e.publicId}/wishlist`,
    `/e/${e.publicId}/wishlist/${g.id}`,
  ])
    assert.equal((await request(path, owner.cookie)).status, 404);
  assert.equal(
    (
      await request(
        base + "/gifts",
        owner.cookie,
        "POST",
        { title: "Closed" },
        owner.csrf,
      )
    ).status,
    404,
  );
  console.info(
    "PASS: staging real Gift CRUD/versions/idempotency, same-event ownership, empty SSR/public read without session creation, Surprise ON/OFF projections, real private Storage and bounded image proxies, invalid uploads and attachment guards, edit reservation preservation, confirmed soft delete/cancellation, shared images, actual parallel edit/reserve-delete, complete microsecond pagination and deleted routes. Physical device interactions remain manual.",
  );
} catch (error) {
  const numeric =
    error instanceof assert.AssertionError &&
    typeof error.actual === "number" &&
    typeof error.expected === "number"
      ? ` Expected ${error.expected}, received ${error.actual}.`
      : "";
  console.error(
    `Wishlist smoke failed at ${phase}.${numeric} Secrets and payloads suppressed.`,
  );
  process.exitCode = 1;
} finally {
  for (const tid of tids) {
    const [owner] =
      await sql`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Slice06 smoke' AND created_at>=${started}`;
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
      await tx`DELETE FROM app.wishlists WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${owner.id})`;
      await tx`DELETE FROM app.events WHERE organizer_id=${owner.id}`;
      await tx`DELETE FROM app.media_assets WHERE owner_user_id=${owner.id}`;
      await tx`DELETE FROM app.mini_app_logins WHERE session_hash IN(SELECT token_hash FROM app.organizer_sessions WHERE user_id=${owner.id})`;
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${owner.id}`;
      await tx`DELETE FROM app.users WHERE id=${owner.id}`;
    });
  }
  for (const id of guestIds)
    await sql`DELETE FROM app.guest_identities WHERE id=${id} AND created_at>=${started} AND display_name='Slice06 private reserver'`;
  await sql.end();
}
