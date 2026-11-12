import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";
export async function migrate(sql: ReturnType<typeof postgres>) {
  await sql`CREATE SCHEMA IF NOT EXISTS app_meta`;
  await sql`CREATE TABLE IF NOT EXISTS app_meta.migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(717030101)`;
    for (const name of (await readdir("supabase/migrations"))
      .filter((v) => v.endsWith(".sql"))
      .sort()) {
      const source = await readFile(
          path.join("supabase/migrations", name),
          "utf8",
        ),
        checksum = createHash("sha256").update(source).digest("hex");
      const [existing] =
        await tx`SELECT checksum FROM app_meta.migrations WHERE name=${name}`;
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error("Applied migration changed: " + name);
        continue;
      }
      await tx.unsafe(source);
      await tx`INSERT INTO app_meta.migrations(name,checksum) VALUES(${name},${checksum})`;
      console.info("Applied " + name);
    }
  });
}
