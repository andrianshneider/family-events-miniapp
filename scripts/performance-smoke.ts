// Same synthetic fixture and host before/after; never outputs cookies or signed URLs.
import nextEnv from "@next/env";
import postgres from "postgres";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { databaseTls } from "../src/server/db/tls";
import assert from "node:assert/strict";
nextEnv.loadEnvConfig(process.cwd());
const phase = process.argv[2] ?? "before",
  root = "https://family-events-staging.vercel.app";
const sql = postgres(process.env.DATABASE_URL!, {
  ssl: databaseTls(),
  max: 1,
  prepare: false,
});
const store = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
).storage.from("event-media");
const file = ".secrets/performance-fixture.json";
type Fixture = {
  userId: string;
  token: string;
  eventId: string;
  path: string;
  assetId: string;
};
let f: Fixture;
await mkdir(".secrets", { recursive: true, mode: 0o700 });
try {
  try {
    f = JSON.parse(await readFile(file, "utf8"));
  } catch {
    const [user] =
      await sql`INSERT INTO app.users(telegram_user_id,display_name) VALUES(${String(BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n)},'Performance probe') RETURNING id`;
    const token = randomBytes(32).toString("base64url"),
      assetId = randomUUID(),
      path = `ready/${user.id}/${assetId}/performance.webp`;
    f = { userId: user.id, token, eventId: "", path, assetId };
    await writeFile(file, JSON.stringify(f), { mode: 0o600 });
    await sql`INSERT INTO app.organizer_sessions(user_id,token_hash,expires_at) VALUES(${user.id},${createHash("sha256").update(token).digest()},now()+interval '2 hours')`;
    const image = await sharp(randomBytes(1200 * 800 * 3), {
      raw: { width: 1200, height: 800, channels: 3 },
    })
      .webp({ quality: 85 })
      .toBuffer();
    const upload = await store.upload(path, image, {
      contentType: "image/webp",
    });
    if (upload.error) throw Error("Fixture upload failed");
    await sql`INSERT INTO app.media_assets(id,owner_user_id,storage_path,mime_type,byte_size,width,height,state) VALUES(${assetId},${user.id},${path},'image/webp',${image.length},1200,800,'ready')`;
    const [event] =
      await sql`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at,cover_asset_id) VALUES(${user.id},${randomBytes(16).toString("base64url")},'Performance fixture','family','2027-01-01','UTC','2027-01-01T00:00Z',${assetId}) RETURNING id`;
    f.eventId = event.id;
    await writeFile(file, JSON.stringify(f), { mode: 0o600 });
  }
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const result: Record<string, unknown> = { warmup: i === 0 };
    let sum = 0,
      background = 0;
    for (const [key, p] of [
      ["page", "/events"],
      ["profile", "/api/v1/me"],
      ["list", "/api/v1/events"],
    ] as const) {
      const t = performance.now();
      const r = await fetch(root + p, {
        headers: { Cookie: "__Host-fe_org=" + f.token },
      });
      assert.equal(r.status, 200);
      const bytes = await r.arrayBuffer();
      const ms = Math.round(performance.now() - t);
      result[key] = ms;
      sum += ms;
      if (key !== "page") background += ms;
      result.region = r.headers
        .get("x-vercel-id")
        ?.split("::")
        .slice(0, 2)
        .join("::");
      result[key + "Timing"] = r.headers.get("server-timing");
      if (key === "page")
        result.ssrHasEvent = Buffer.from(bytes)
          .toString()
          .includes("Performance fixture");
      if (key === "list") {
        const body = JSON.parse(Buffer.from(bytes).toString());
        assert.equal(body.data.events.length, 1);
        assert.equal(body.data.events[0].id, f.eventId);
        const t2 = performance.now();
        const cover = await fetch(new URL(body.data.events[0].coverUrl, root), {
          headers: { Cookie: "__Host-fe_org=" + f.token },
        });
        assert.equal(cover.status, 200);
        result.coverBytes = (await cover.arrayBuffer()).byteLength;
        result.coverMs = Math.round(performance.now() - t2);
      }
    }
    result.initialDataMs = phase === "before" ? sum : result.page;
    result.backgroundMs = phase === "before" ? background : result.list;
    samples.push(result);
    console.log(JSON.stringify(result));
  }
  await mkdir("docs/performance", { recursive: true });
  await writeFile(
    `docs/performance/${phase}.json`,
    JSON.stringify(
      { date: new Date().toISOString(), root, warmupExcluded: true, samples },
      null,
      2,
    ) + "\n",
  );
  if (phase === "after") {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM app.events WHERE organizer_id=${f.userId}`;
      await tx`DELETE FROM app.media_assets WHERE id=${f.assetId} AND owner_user_id=${f.userId}`;
      await tx`DELETE FROM app.organizer_sessions WHERE user_id=${f.userId}`;
      await tx`DELETE FROM app.users WHERE id=${f.userId} AND display_name='Performance probe'`;
    });
    await store.remove([f.path, f.path.replace(/\.webp$/, ".thumb.webp")]);
    await unlink(file);
    console.log("Fixture cleaned");
  }
} finally {
  await sql.end();
}
