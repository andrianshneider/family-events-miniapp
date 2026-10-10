// Export only runtime settings, never the migration administrator connection.
import nextEnv from "@next/env";
import { writeFile, mkdir } from "node:fs/promises";
nextEnv.loadEnvConfig(process.cwd());
const allowed = [
  "DATABASE_URL",
  "DATABASE_WORKER_URL",
  "DATABASE_SSL",
  "DATABASE_CA_CERT_BASE64",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_MEDIA_BUCKET",
  "SESSION_SECRET",
  "AUTH_ENCRYPTION_KEY",
  "RATE_LIMIT_SECRET",
  "CRON_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_CLIENT_ID",
  "TELEGRAM_CLIENT_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
  "AUTH_RATE_LIMIT",
  "GUEST_SESSION_RATE_LIMIT",
  "PUBLIC_READ_RATE_LIMIT",
];
const values: Record<string, string> = {
  APP_ENV: "staging",
  APP_URL:
    "https://family-events-miniapp-git-infrastructure-foundation-ast-dbae.vercel.app",
};
for (const key of allowed)
  if (process.env[key]) values[key] = process.env[key]!;
await mkdir(".secrets", { recursive: true, mode: 0o700 });
await writeFile(
  ".secrets/vercel-preview.env",
  Object.entries(values)
    .map(([k, v]) => k + "=" + JSON.stringify(v))
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.info(
  "Preview-only import file prepared without administrator credentials.",
);
console.info(
  "Missing Telegram credentials: " +
    ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CLIENT_ID", "TELEGRAM_CLIENT_SECRET"]
      .filter((k) => !values[k])
      .join(", "),
);
