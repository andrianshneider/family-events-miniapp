// Existing staging Supabase only. Stores the existing Preview secret in Vault, never in cron text.
import nextEnv from "@next/env";
import postgres from "postgres";
import { databaseTls } from "../src/server/db/tls";
nextEnv.loadEnvConfig(process.cwd());
const ref = "jjrjdogsjbdvacusvnki",
  root = "https://family-events-staging.vercel.app",
  job = "family-events-staging-organizer-notifications",
  secretName = "family_events_staging_organizer_cron",
  mode = process.env.SCHEDULER_MODE ?? "prepare";
const admin = new URL(process.env.DATABASE_ADMIN_URL!);
if (
  (process.env.SMOKE_URL && process.env.SMOKE_URL !== root) ||
  (!admin.hostname.includes(ref) &&
    !decodeURIComponent(admin.username).includes(ref)) ||
  !["prepare", "enable", "pause", "status"].includes(mode)
)
  throw Error("Existing staging only");
const q = postgres(process.env.DATABASE_ADMIN_URL!, {
  max: 1,
  prepare: false,
  ssl: databaseTls(),
  onnotice: () => {},
});
try {
  if (mode === "prepare") {
    await q.unsafe(
      "CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog",
    );
    await q.unsafe(
      "CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions",
    );
    const [vault] =
      await q`SELECT id FROM vault.secrets WHERE name=${secretName}`;
    if (vault)
      await q`SELECT vault.update_secret(${vault.id},${process.env.CRON_SECRET!},${secretName},'Existing staging organizer worker credential')`;
    else
      await q`SELECT vault.create_secret(${process.env.CRON_SECRET!},${secretName},'Existing staging organizer worker credential')`;
    // Hosted pg_net queue grants cannot be changed per project. It carries a 120-second
    // endpoint-scoped, nonce-bound HMAC proof, never the long-lived Vault secret.
    const command = `WITH proof AS (SELECT floor(extract(epoch FROM clock_timestamp()))::bigint::text AS stamp,gen_random_uuid()::text AS nonce) SELECT net.http_post(url:='${root}/api/internal/organizer-notifications',headers:=jsonb_build_object('Content-Type','application/json','x-scheduler-timestamp',stamp,'x-scheduler-nonce',nonce,'x-scheduler-signature',encode(extensions.hmac('organizer-notifications'||chr(10)||stamp||chr(10)||nonce,(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='${secretName}'),'sha256'),'hex')),body:='{}'::jsonb,timeout_milliseconds:=60000) FROM proof;`;
    const [existing] = await q`SELECT jobid FROM cron.job WHERE jobname=${job}`;
    if (existing)
      await q`SELECT cron.alter_job(${existing.jobid},schedule:='* * * * *',command:=${command},active:=false)`;
    else {
      const [created] =
        await q`SELECT cron.schedule(${job},'* * * * *',${command}) AS id`;
      await q`SELECT cron.alter_job(${created.id},active:=false)`;
    }
  }
  if (mode === "enable" || mode === "pause") {
    const [j] = await q`SELECT jobid FROM cron.job WHERE jobname=${job}`;
    if (!j) throw Error("Prepare scheduler first");
    await q`SELECT cron.alter_job(${j.jobid},active:=${mode === "enable"})`;
  }
  console.log(
    await q`SELECT jobname,schedule,active FROM cron.job WHERE jobname=${job}`,
  );
  const [vaultAccess] =
    await q`SELECT has_table_privilege('anon','vault.decrypted_secrets','SELECT') AS anon_vault,has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') AS authenticated_vault`;
  if (vaultAccess.anon_vault || vaultAccess.authenticated_vault)
    throw Error("Vault must remain private");
  console.log(
    "Vault stays private; scheduler uses a scoped short-lived single-use transit proof.",
  );
} catch (e) {
  console.error(
    "Scheduler setup failed; code: " +
      (e && typeof e === "object" && "code" in e
        ? String(e.code)
        : "CONFIG_OR_NETWORK"),
  );
  process.exitCode = 1;
} finally {
  await q.end();
}
