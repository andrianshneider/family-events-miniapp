import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import assert from "node:assert/strict";
loadEnvConfig(process.cwd());
const url = process.env.SMOKE_URL ?? process.env.APP_URL;
if (!url) throw new Error("APP_URL/SMOKE_URL required");
const health = await fetch(url + "/api/health");
assert.equal(health.status, 200);
const me = await fetch(url + "/api/v1/me");
assert.equal(me.status, 401);
const readiness = await fetch(url + "/api/internal/readiness", {
  headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
});
assert.equal(readiness.status, 200);
assert.deepEqual((await readiness.json()).data, {
  database: true,
  schema: true,
  storage: true,
  dal: true,
});
console.info(
  "PASS: HTTP health, protected operation, actual DB/schema, Storage, DAL create/read with rollback.",
);
