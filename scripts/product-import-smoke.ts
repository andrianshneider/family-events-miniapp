// Existing staging only. Synthetic fixture owners, gifts, reservations and Storage files.
import nextEnv from "@next/env";
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
);
const request = (
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
  csrf?: string,
) =>
  fetch(root + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: root,
      "Content-Type": "application/json",
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      "idempotency-key": randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(35000),
  });
async function login(tid: string): Promise<Actor> {
  const p = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: randomUUID(),
      user: JSON.stringify({
        id: Number(tid),
        first_name: "Product import smoke",
      }),
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

let phase = "login";
try {
  const owner = await login(tids[0]),
    other = await login(tids[1]);
  const e = await makeEvent(owner, "Product import smoke");
  const path = `/api/v1/events/${e.id}/gifts/import`;
  phase = "auth and ownership";
  assert.equal(
    (await request(path, "", "POST", { url: "https://example.com" })).status,
    401,
  );
  assert.equal(
    (
      await request(
        path,
        other.cookie,
        "POST",
        { url: "https://example.com" },
        other.csrf,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request(path, owner.cookie, "POST", { url: "https://example.com" }))
      .status,
    403,
  );
  phase = "private network rejection";
  assert.equal(
    (
      await request(
        path,
        owner.cookie,
        "POST",
        { url: "http://169.254.169.254/latest/meta-data" },
        owner.csrf,
      )
    ).status,
    422,
  );
  phase = "real shop metadata";
  const response = await request(
    path,
    owner.cookie,
    "POST",
    {
      url: "https://apple-market.ru/smartfon-apple-iphone-duo-256-gb-dual-sim-esim-night-sky/",
    },
    owner.csrf,
  );
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert(
    result.title &&
      result.amount &&
      result.currency === "RUB" &&
      result.image?.data,
  );
  const bytes = Buffer.from(result.image.data, "base64");
  phase = "real Storage";
  const prepared = await request(
    "/api/v1/media/uploads",
    owner.cookie,
    "POST",
    { mimeType: result.image.mimeType, byteSize: bytes.length },
    owner.csrf,
  );
  assert.equal(prepared.status, 201);
  const asset = (await prepared.json()).data;
  const put = await fetch(asset.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": result.image.mimeType, "x-upsert": "false" },
    body: new Uint8Array(bytes),
  });
  assert(put.ok);
  assert.equal(
    (
      await request(
        `/api/v1/media/${asset.assetId}/complete`,
        owner.cookie,
        "POST",
        undefined,
        owner.csrf,
      )
    ).status,
    200,
  );
  phase = "gift creation and reload";
  const created = await request(
    `/api/v1/events/${e.id}/gifts`,
    owner.cookie,
    "POST",
    {
      title: result.title,
      amount: result.amount,
      currency: result.currency,
      externalUrl:
        "https://apple-market.ru/smartfon-apple-iphone-duo-256-gb-dual-sim-esim-night-sky/",
      imageAssetId: asset.assetId,
      comment: "Keep manual comment",
    },
    owner.csrf,
  );
  assert.equal(created.status, 201);
  const wishlist = await request(
    `/api/v1/events/${e.id}/wishlist`,
    owner.cookie,
  );
  const g = (await wishlist.json()).data.gifts[0];
  assert.equal(g.title, result.title);
  assert.equal(Number(g.amount), Number(result.amount));
  assert.equal(g.comment, "Keep manual comment");
  assert.equal((await request(g.imageUrl, owner.cookie)).status, 200);
  console.info(
    "PASS: staging owner/CSRF isolation, private URL rejection, real shop title/price/photo, Storage upload, Gift save and DB reload/image.",
  );
} catch (error) {
  const numeric =
    error instanceof assert.AssertionError &&
    typeof error.actual === "number" &&
    typeof error.expected === "number"
      ? ` Expected ${error.expected}, received ${error.actual}.`
      : "";
  console.error(
    `Product import smoke failed at ${phase}.${numeric} Secrets and payloads suppressed.`,
  );
  process.exitCode = 1;
} finally {
  for (const tid of tids) {
    const [owner] =
      await sql`SELECT id FROM app.users WHERE telegram_user_id=${tid} AND display_name='Product import smoke' AND created_at>=${started}`;
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
  await sql.end();
}
