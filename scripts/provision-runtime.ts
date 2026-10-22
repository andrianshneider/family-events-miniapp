import { databaseTls } from "../src/server/db/tls";
// Run only with the migration administrator. No credential is printed.
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
loadEnvConfig(process.cwd());
const admin = process.env.DATABASE_ADMIN_URL;
if (!admin) throw new Error("DATABASE_ADMIN_URL required");
const sql = postgres(admin, { max: 1, prepare: false, ssl: databaseTls() });
let env = await readFile(".env.local", "utf8");
function set(name: string, value: string) {
  const rx = new RegExp("^" + name + "=.*$", "m");
  env = rx.test(env)
    ? env.replace(rx, name + "=" + value)
    : env + "\n" + name + "=" + value + "\n";
}
try {
  for (const [name, group, key] of [
    ["fe_app_login", "fe_server", "DATABASE_URL"],
    ["fe_worker_login", "fe_worker", "DATABASE_WORKER_URL"],
  ]) {
    const [existing] = await sql`SELECT 1 FROM pg_roles WHERE rolname=${name}`;
    if (existing) {
      if (!process.env[key])
        throw new Error(
          "Role exists: configure " + key + " without rotating its password.",
        );
      continue;
    }
    const password = randomBytes(32).toString("hex");
    // Identifiers and password have fixed/hex allowlists; no arbitrary SQL construction.
    await sql.unsafe(
      `CREATE ROLE ${name} LOGIN NOSUPERUSER NOBYPASSRLS INHERIT PASSWORD '${password}'`,
    );
    await sql.unsafe(`GRANT ${group} TO ${name}`);
    const url = new URL(admin);
    url.username = name + "." + process.env.SUPABASE_PROJECT_REF;
    url.password = password;
    url.port = "6543";
    set(key, url.toString());
    await writeFile(".env.local", env, { mode: 0o600 });
  }
  await writeFile(".env.local", env, { mode: 0o600 });
  console.info("Restricted runtime and worker connections stored locally.");
} catch (error) {
  console.error(
    "Runtime provisioning failed; code: " +
      (error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "CONFIG_OR_NETWORK"),
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
