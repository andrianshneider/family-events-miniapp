// User enters raw password in ignored file. Never print or pass it on CLI arguments.
import { readFile, writeFile } from "node:fs/promises";
const raw = await readFile(".secrets/db-password", "utf8");
const password = raw.replace(/\r?\n$/, "");
if (!password) throw new Error("Enter password in .secrets/db-password");
const encoded = encodeURIComponent(password).replace(
  /[!'()*]/g,
  (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
);
let env = await readFile(".env.local", "utf8");
const url =
  "postgresql://postgres.jjrjdogsjbdvacusvnki:" +
  encoded +
  "@aws-1-eu-central-1.pooler.supabase.com:5432/postgres";
env = env.replace(/^DATABASE_ADMIN_URL=.*$/m, "DATABASE_ADMIN_URL=" + url);
await writeFile(".env.local", env, { mode: 0o600 });
await writeFile(".secrets/db-password", "", { mode: 0o600 });
console.info(
  "Password encoded and stored only in ignored .env.local. Input file cleared.",
);
