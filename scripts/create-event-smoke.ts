// Restricted hosted staging verification. Synthetic Telegram users; never real user fixtures.
import nextEnv from "@next/env";
import postgres from "postgres";
import sharp from "sharp";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { databaseTls } from "../src/server/db/tls";
nextEnv.loadEnvConfig(process.cwd());
const root =
  process.env.SMOKE_URL ?? "https://family-events-staging.vercel.app";
const ref = "jjrjdogsjbdvacusvnki";
const connection = new URL(process.env.DATABASE_URL!);
if (
  root !== "https://family-events-staging.vercel.app" ||
  new URL(process.env.SUPABASE_URL!).hostname !== ref + ".supabase.co" ||
  !(
    connection.hostname.includes(ref) ||
    decodeURIComponent(connection.username).includes(ref)
  )
)
  throw Error("Only existing staging is allowed");
const sql = postgres(process.env.DATABASE_URL!, {
  max: 1,
  prepare: false,
  ssl: databaseTls(),
});
const storage = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
).storage.from(process.env.SUPABASE_MEDIA_BUCKET ?? "event-media");
const ids = [0, 1].map(() =>
  String(BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n),
);
const startedAt = new Date();
type Actor = { id: string; cookie: string; csrf: string };
let phase = "login";
const actors: Actor[] = [];
let oidcState: string | undefined;
const fetchWithTimeout = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
async function login(tid: string) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id: Number(tid), first_name: "Slice02 smoke" }),
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
          .map(([key, value]) => key + "=" + value)
          .join("\n"),
      )
      .digest("hex"),
  );
  const response = await fetchWithTimeout(
    root + "/api/auth/telegram/mini-app",
    {
      method: "POST",
      headers: { Origin: root, "Content-Type": "application/json" },
      body: JSON.stringify({ initData: p.toString() }),
    },
  );
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-fe_org="))!
    .split(";")[0];
  const id = (await response.json()).data.id;
  const csrf = await (
    await fetchWithTimeout(root + "/api/auth/csrf", {
      headers: { Cookie: cookie },
    })
  ).json();
  return { id, cookie, csrf: csrf.data.csrfToken };
}
const request = (
  actor: Actor,
  path: string,
  method = "GET",
  payload?: unknown,
  key?: string,
) =>
  fetchWithTimeout(root + path, {
    method,
    headers: {
      Cookie: actor.cookie,
      Origin: root,
      "Content-Type": "application/json",
      "x-csrf-token": actor.csrf,
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
async function upload(
  actor: Actor,
  bytes: Buffer,
  mime = "image/jpeg",
  valid = true,
) {
  const response = await request(actor, "/api/v1/media/uploads", "POST", {
    mimeType: mime,
    byteSize: bytes.length,
  });
  assert.equal(response.status, 201);
  const prepared = (await response.json()).data;
  const sent = await fetchWithTimeout(prepared.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": mime, "x-upsert": "false" },
    body: new Uint8Array(bytes),
  });
  assert.equal(sent.ok, true);
  const complete = await request(
    actor,
    `/api/v1/media/${prepared.assetId}/complete`,
    "POST",
  );
  assert.equal(complete.status, valid ? 200 : 422);
  return prepared.assetId as string;
}
try {
  phase = "restricted runtime role";
  const [role] =
    await sql`SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'fe_server','member') AS server FROM pg_roles WHERE rolname=current_user`;
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  assert.equal(role.server, true);
  phase = "login";
  actors.push(await login(ids[0]));
  actors.push(await login(ids[1]));
  const [owner, other] = actors;
  phase = "form and CSRF";
  const form = await request(owner, "/events/new");
  assert.equal(form.status, 200);
  const formHtml = await form.text();
  assert(
    formHtml.includes("Создать событие") &&
      formHtml.includes("Детали для гостей"),
  );
  const unauth = await fetchWithTimeout(root + "/events/new", {
    redirect: "manual",
  });
  assert.equal(unauth.status, 307);
  assert(new URL(unauth.headers.get("location")!, root).pathname === "/login");
  const minimal = {
    title: "Slice02 private minimum",
    eventType: "family",
    eventDate: "2030-01-01",
    timezone: "Europe/Moscow",
  };
  const noCsrf = await fetchWithTimeout(root + "/api/v1/events", {
    method: "POST",
    headers: {
      Cookie: owner.cookie,
      Origin: root,
      "Content-Type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify(minimal),
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(
    (
      await fetchWithTimeout(root + "/api/v1/events", {
        method: "POST",
        headers: { Origin: root, "Content-Type": "application/json" },
        body: JSON.stringify(minimal),
      })
    ).status,
    401,
  );
  for (const payload of [
    { ...minimal, organizerId: other.id },
    { ...minimal, eventDate: "2020-01-01" },
    { ...minimal, title: " " },
    { ...minimal, endTime: "19:00" },
    { ...minimal, startTime: "23:00", endTime: "01:00" },
    {
      ...minimal,
      eventDate: "2030-03-31",
      timezone: "Europe/Berlin",
      startTime: "02:30",
    },
  ])
    assert.equal(
      (await request(owner, "/api/v1/events", "POST", payload, randomUUID()))
        .status,
      422,
    );
  phase = "minimal creation and repeat";
  const key = randomUUID();
  const first = await request(owner, "/api/v1/events", "POST", minimal, key);
  assert.equal(first.status, 201);
  const event = (await first.json()).data;
  assert.match(event.publicId, /^[\w-]{22}$/);
  assert.deepEqual(
    (
      await (
        await request(owner, "/api/v1/events", "POST", minimal, key)
      ).json()
    ).data,
    event,
  );
  assert.equal(
    (
      await request(
        owner,
        "/api/v1/events",
        "POST",
        { ...minimal, title: "Changed payload" },
        key,
      )
    ).status,
    409,
  );
  const [dbEvent] =
    await sql`SELECT e.organizer_id,e.starts_at,e.ends_at,e.effective_at,(SELECT count(*)::int FROM app.wishlists w WHERE w.event_id=e.id) AS wishlists FROM app.events e WHERE e.id=${event.id}`;
  assert.equal(dbEvent.organizer_id, owner.id);
  assert.equal(dbEvent.wishlists, 1);
  assert.equal(dbEvent.starts_at, null);
  assert.equal(dbEvent.ends_at, null);
  assert.equal(
    new Date(dbEvent.effective_at).toISOString(),
    "2029-12-31T21:00:00.000Z",
  );
  phase = "API and page isolation";
  const detail = await request(owner, `/api/v1/events/${event.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get("cache-control"), "private, no-store");
  const own = (await detail.json()).data;
  assert.equal(own.title, minimal.title);
  assert.equal(own.wishlist.surprise, true);
  assert.equal(own.wishlist.gifts, 0);
  assert.equal(
    (await request(other, `/api/v1/events/${event.id}`)).status,
    404,
  );
  const foreignPage = await request(other, `/events/${event.id}`);
  const foreignHtml = await foreignPage.text();
  assert(foreignHtml.includes("Событие недоступно"));
  assert(!foreignHtml.includes(minimal.title));
  const page = await request(owner, `/events/${event.id}?created=1`);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert(
    pageHtml.includes("Событие создано") && pageHtml.includes(minimal.title),
  );
  assert.equal((await request(owner, `/events/${event.id}`)).status, 200);
  phase = "concurrent HTTP requests";
  const concurrentKey = randomUUID();
  const pair = await Promise.all([
    request(
      owner,
      "/api/v1/events",
      "POST",
      { ...minimal, title: "Slice02 concurrent" },
      concurrentKey,
    ),
    request(
      owner,
      "/api/v1/events",
      "POST",
      { ...minimal, title: "Slice02 concurrent" },
      concurrentKey,
    ),
  ]);
  assert(pair.every((response) => response.status === 201));
  assert.deepEqual((await pair[0].json()).data, (await pair[1].json()).data);
  const [count] =
    await sql`SELECT count(*)::int AS events FROM app.events WHERE organizer_id=${owner.id}`;
  assert.equal(count.events, 2);
  phase = "real private Storage upload";
  const jpeg = await sharp({
    create: { width: 128, height: 80, channels: 3, background: "#7952c7" },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const asset = await upload(owner, jpeg);
  const privatePreview = await fetchWithTimeout(
    root + `/api/v1/media/${asset}`,
    { headers: { Cookie: owner.cookie }, redirect: "manual" },
  );
  assert.equal(privatePreview.status, 307);
  assert.equal(
    privatePreview.headers.get("cache-control"),
    "private, no-store",
  );
  const image = await fetchWithTimeout(privatePreview.headers.get("location")!);
  assert.equal(image.status, 200);
  const metadata = await sharp(
    Buffer.from(await image.arrayBuffer()),
  ).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 128);
  assert.equal((await request(other, `/api/v1/media/${asset}`)).status, 404);
  await upload(owner, Buffer.from("not an image"), "image/jpeg", false);
  assert.equal(
    (
      await request(owner, "/api/v1/media/uploads", "POST", {
        mimeType: "image/jpeg",
        byteSize: 10485761,
      })
    ).status,
    422,
  );
  phase = "full creation and cover isolation";
  assert.equal(
    (
      await request(
        other,
        "/api/v1/events",
        "POST",
        { ...minimal, coverAssetId: asset },
        randomUUID(),
      )
    ).status,
    422,
  );
  const full = {
    ...minimal,
    title: "Slice02 full cover",
    startTime: "18:00",
    endTime: "21:00",
    venueName: "Дом",
    address: "Москва",
    directions: "Вход со двора",
    description: "Тестовое описание\nс переносом",
    dressCode: "Светлая одежда",
    coverAssetId: asset,
  };
  const fullResponse = await request(
    owner,
    "/api/v1/events",
    "POST",
    full,
    randomUUID(),
  );
  assert.equal(fullResponse.status, 201);
  const fullEvent = (await fullResponse.json()).data;
  const fullDetail = (
    await (await request(owner, `/api/v1/events/${fullEvent.id}`)).json()
  ).data;
  assert.equal(fullDetail.description, full.description);
  assert.equal(fullDetail.startTime, "18:00");
  assert.equal(fullDetail.endTime, "21:00");
  assert.equal((await request(owner, fullDetail.coverUrl)).status, 200);
  assert.equal((await request(other, fullDetail.coverUrl)).status, 404);
  const fullPage = await request(owner, `/events/${fullEvent.id}`);
  const fullHtml = await fullPage.text();
  assert(
    fullHtml.includes(full.description.split("\n")[0]) &&
      fullHtml.includes(fullDetail.coverUrl),
  );
  const listed = (
    await (
      await request(owner, "/api/v1/events?organizer_id=" + other.id)
    ).json()
  ).data.events;
  assert(
    listed.some((item: { id: string }) => item.id === event.id) &&
      listed.some((item: { id: string }) => item.id === fullEvent.id),
  );
  assert.equal(
    listed.find((item: { id: string }) => item.id === event.id).coverUrl,
    null,
  );
  assert.equal(
    listed.find((item: { id: string }) => item.id === fullEvent.id).coverUrl,
    fullDetail.coverUrl,
  );
  phase = "edit event, replace/remove cover, version conflict and ownership";
  const editPath = `/events/${fullEvent.id}/edit`;
  const editHtml = await (await request(owner, editPath)).text();
  assert(
    editHtml.includes("Редактировать событие") &&
      editHtml.includes("Сохранить изменения"),
  );
  const foreignEditHtml = await (await request(other, editPath)).text();
  assert(
    foreignEditHtml.includes("Событие недоступно") &&
      !foreignEditHtml.includes(full.title),
  );
  const patchPath = `/api/v1/events/${fullEvent.id}`;
  const editedFields = {
    ...full,
    title: "Slice02 edited event",
    venueName: "Новое место",
    coverAssetId: null,
  };
  const editPayload = {
    expectedVersion: fullDetail.version,
    fields: editedFields,
  };
  assert.equal(
    (await request(other, patchPath, "PATCH", editPayload, randomUUID()))
      .status,
    404,
  );
  assert.equal(
    (
      await request(
        { ...owner, csrf: "invalid" },
        patchPath,
        "PATCH",
        editPayload,
        randomUUID(),
      )
    ).status,
    403,
  );
  const editKey = randomUUID();
  const editResponse = await request(
    owner,
    patchPath,
    "PATCH",
    editPayload,
    editKey,
  );
  assert.equal(editResponse.status, 200);
  const edited = (await editResponse.json()).data;
  assert.equal(edited.version, fullDetail.version + 1);
  assert.deepEqual(
    (
      await (
        await request(owner, patchPath, "PATCH", editPayload, editKey)
      ).json()
    ).data,
    edited,
  );
  assert.equal(
    (await request(owner, patchPath, "PATCH", editPayload, randomUUID()))
      .status,
    409,
  );
  const removedCover = (await (await request(owner, patchPath)).json()).data;
  assert.equal(removedCover.coverUrl, null);
  assert.equal(removedCover.title, editedFields.title);
  assert.equal(
    (await request(owner, `/api/v1/events/${fullEvent.id}/cover`)).status,
    404,
  );
  const replacementId = await upload(
    owner,
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#7952c7" },
    })
      .png()
      .toBuffer(),
    "image/png",
  );
  const replaceResponse = await request(
    owner,
    patchPath,
    "PATCH",
    {
      expectedVersion: edited.version,
      fields: { ...editedFields, coverAssetId: replacementId },
    },
    randomUUID(),
  );
  assert.equal(replaceResponse.status, 200);
  const replacement = (await (await request(owner, patchPath)).json()).data;
  assert.equal(replacement.coverAssetId, replacementId);
  assert.equal((await request(owner, replacement.coverUrl)).status, 200);
  assert.equal((await request(other, replacement.coverUrl)).status, 404);
  const listAfterEdit = (await (await request(owner, "/api/v1/events")).json())
    .data.events;
  assert.equal(
    listAfterEdit.find((item: { id: string }) => item.id === fullEvent.id)
      .title,
    editedFields.title,
  );
  const [wishlistCount] =
    await sql`SELECT count(*)::int AS count FROM app.wishlists WHERE event_id=${fullEvent.id}`;
  assert.equal(wishlistCount.count, 1);
  const editParallel = await Promise.all([
    request(
      owner,
      patchPath,
      "PATCH",
      {
        expectedVersion: replacement.version,
        fields: { ...editedFields, title: "Slice02 concurrent edit A" },
      },
      randomUUID(),
    ),
    request(
      owner,
      patchPath,
      "PATCH",
      {
        expectedVersion: replacement.version,
        fields: { ...editedFields, title: "Slice02 concurrent edit B" },
      },
      randomUUID(),
    ),
  ]);
  assert.deepEqual(
    editParallel.map((response) => response.status).sort(),
    [200, 409],
  );
  phase = "expired session and safe auth return";
  const hash = createHash("sha256").update(owner.cookie.split("=")[1]).digest();
  await sql`UPDATE app.organizer_sessions SET created_at=now()-make_interval(days=>31),expires_at=now()-make_interval(secs=>1) WHERE token_hash=${hash}`;
  assert.equal(
    (await request(owner, "/api/v1/events", "POST", minimal, randomUUID()))
      .status,
    401,
  );
  const expiredPage = await fetchWithTimeout(root + "/events/new", {
    headers: { Cookie: owner.cookie },
    redirect: "manual",
  });
  assert.equal(expiredPage.status, 307);
  assert.equal(
    new URL(expiredPage.headers.get("location")!, root).searchParams.get(
      "returnTo",
    ),
    "/events/new",
  );
  const expiredEdit = await fetchWithTimeout(root + editPath, {
    headers: { Cookie: owner.cookie },
    redirect: "manual",
  });
  assert.equal(expiredEdit.status, 307);
  assert.equal(
    new URL(expiredEdit.headers.get("location")!, root).searchParams.get(
      "returnTo",
    ),
    editPath,
  );
  await sql`UPDATE app.organizer_sessions SET expires_at=now()+make_interval(days=>1) WHERE token_hash=${hash}`;
  const start = await fetchWithTimeout(
    root + "/api/auth/telegram/start?returnTo=" + encodeURIComponent(editPath),
    { redirect: "manual" },
  );
  assert.equal(start.status, 307);
  oidcState = new URL(start.headers.get("location")!).searchParams.get(
    "state",
  )!;
  const [auth] =
    await sql`SELECT return_path FROM app.auth_transactions WHERE state_hash=${createHash("sha256").update(oidcState).digest()}`;
  assert.equal(auth.return_path, editPath);
  phase = "soft deletion";
  await sql`UPDATE app.events SET deleted_at=now() WHERE id=${event.id} AND organizer_id=${owner.id}`;
  assert.equal(
    (await request(owner, `/api/v1/events/${event.id}`)).status,
    404,
  );
  const deleted = await request(owner, `/events/${event.id}`);
  const deletedHtml = await deleted.text();
  assert(
    deletedHtml.includes("Событие недоступно") &&
      !deletedHtml.includes(minimal.title),
  );
  console.info(
    "PASS: staging creation and editing, minimal/full event + wishlist, cover replacement/removal, CSRF, validation, idempotency, concurrent version conflict, DB persistence, refresh, private pages, actual Storage upload/EXIF removal, owner isolation, expiry and edit auth returnTo. Browser interaction and iPhone checks remain manual.",
  );
} catch {
  console.error(
    "Slice02 staging smoke failed at: " +
      phase +
      ". Credentials and payloads suppressed.",
  );
  process.exitCode = 1;
} finally {
  for (const tid of ids) {
    const [user] =
      await sql`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Slice02 smoke' AND created_at>=${startedAt}`;
    if (!user) continue;
    const paths =
      await sql`SELECT storage_path FROM app.media_assets WHERE owner_user_id=${user.id}`;
    if (paths.length) {
      const removed = await storage.remove(
        paths.flatMap((row) => [
          row.storage_path,
          row.storage_path.replace(/\.webp$/, ".thumb.webp"),
        ]),
      );
      if (removed.error) {
        console.error("Fixture Storage cleanup failed; paths suppressed.");
        process.exitCode = 1;
      }
    }
    await sql.begin(async (tx) => {
      await tx`DELETE FROM app.analytics_events WHERE user_id=${user.id}`;
      await tx`DELETE FROM app.api_idempotency WHERE principal_key=${"organizer:" + user.id}`;
      await tx`DELETE FROM app.wishlists WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${user.id})`;
      await tx`DELETE FROM app.event_changes WHERE event_id IN(SELECT id FROM app.events WHERE organizer_id=${user.id})`;
      await tx`DELETE FROM app.events WHERE organizer_id=${user.id}`;
      await tx`DELETE FROM app.media_assets WHERE owner_user_id=${user.id}`;
      await tx`DELETE FROM app.mini_app_logins WHERE session_hash IN(SELECT token_hash FROM app.organizer_sessions WHERE user_id=${user.id})`;
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${user.id}`;
      await tx`DELETE FROM app.users WHERE id=${user.id}`;
    });
  }
  if (oidcState)
    await sql`DELETE FROM app.auth_transactions WHERE state_hash=${createHash("sha256").update(oidcState).digest()} AND consumed_at IS NULL`;
  await sql.end();
}
