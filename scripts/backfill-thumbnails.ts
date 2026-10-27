// Staging only. Creates derived thumbnails, preserving all original assets.
import nextEnv from "@next/env";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { databaseTls } from "../src/server/db/tls";
import { thumbnail, thumbnailPath } from "../src/server/storage/thumbnails";
nextEnv.loadEnvConfig(process.cwd());
const sql = postgres(process.env.DATABASE_URL!, {
  ssl: databaseTls(),
  max: 1,
  prepare: false,
});
const store = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
).storage.from("event-media");
let count = 0;
try {
  const rows =
    await sql`SELECT storage_path FROM app.media_assets WHERE state='ready'`;
  for (const row of rows) {
    const path = thumbnailPath(row.storage_path);
    if (path === row.storage_path) continue;
    const existing = await store.download(path);
    if (!existing.error && existing.data) continue;
    const source = await store.download(row.storage_path);
    if (source.error || !source.data) throw Error("Original image unavailable");
    const result = await store.upload(
      path,
      await thumbnail(Buffer.from(await source.data.arrayBuffer())),
      { contentType: "image/webp", upsert: false },
    );
    if (result.error) throw Error("Thumbnail upload failed");
    count++;
  }
  console.log("Thumbnails created:", count);
} finally {
  await sql.end();
}
