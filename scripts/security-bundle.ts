import nextEnv from "@next/env";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
nextEnv.loadEnvConfig(process.cwd());
const keys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CLIENT_SECRET",
  "DATABASE_URL",
  "DATABASE_WORKER_URL",
  "DATABASE_ADMIN_URL",
  "AUTH_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "RATE_LIMIT_SECRET",
  "CRON_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
];
async function scan(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = dir + "/" + entry.name;
    if (entry.isDirectory()) await scan(file);
    else if (entry.name.endsWith(".js")) {
      const source = await readFile(file, "utf8");
      for (const key of keys) {
        assert(
          !source.includes(key),
          "Server configuration in browser: " + key,
        );
        const value = process.env[key];
        if (value && value.length >= 20)
          assert(
            !source.includes(value),
            "Secret value leaked to browser: " + key,
          );
      }
    }
  }
}
await scan(".next/static");
console.info(
  "PASS: server configuration and configured secret values absent from browser chunks.",
);
