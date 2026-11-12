import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
// Run with --conditions=react-server; no raw payloads or credentials are printed.
const { queueHealth, drain } = await import("../src/server/analytics/exporter");
if (
  process.env.APP_ENV !== "staging" ||
  process.env.APP_URL !== "https://family-events-staging.vercel.app"
)
  throw Error("Existing staging only");
if (process.argv.includes("--drain"))
  console.info(JSON.stringify(await drain()));
console.info(JSON.stringify(await queueHealth()));
const { db } = await import("../src/server/db/client");
await db().end();
