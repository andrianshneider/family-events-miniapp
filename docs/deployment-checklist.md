# Staging activation checklist

Known existing resources:
- GitHub https://github.com/andrianshneider/family-events-miniapp
- Draft PR https://github.com/andrianshneider/family-events-miniapp/pull/1
- Vercel https://vercel.com/ast-dbae/family-events-miniapp
- Supabase https://supabase.com/dashboard/project/jjrjdogsjbdvacusvnki

1. Validate administrator password in ignored local environment; run `pnpm db:migrate` twice (second run is a checksum no-op).
2. `node --import tsx scripts/provision-runtime.ts` creates restricted server/worker roles and stores passwords locally without printing.
3. Supply server Storage key, run `pnpm storage:setup`; verify bucket private and app absent from Data API schemas.
4. `node --conditions=react-server --import tsx scripts/live-dal-smoke.ts` verifies actual runtime role and authorization using rolled-back fixtures.
5. Connect existing Vercel project to existing GitHub repository, framework Next.js, Root Directory empty, Output Directory framework default, Node 24, branch Preview.
6. Vercel Preview variables: APP_ENV=staging, stable branch Preview APP_URL, DATABASE_URL, DATABASE_WORKER_URL, DATABASE_SSL, SUPABASE_URL, SUPABASE_MEDIA_BUCKET, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET, AUTH_ENCRYPTION_KEY, RATE_LIMIT_SECRET, CRON_SECRET. Do NOT supply DATABASE_ADMIN_URL or password input files to Vercel.
7. Environment-specific Telegram bot, client credentials and webhook secret. Allowed origin/callback must match stable APP_URL. Existing prototype live bot is not automatically redirected.
8. Trigger a Git commit deployment; verify `/api/health`, `/api/v1/me` returns 401 without session and authorized internal readiness succeeds. Run `SMOKE_URL=<preview> pnpm smoke`.
9. Register webhook and Mini App URL after staging is verified. Actual login on Telegram/Web/PWA is a separate live check; synthetic payload tests do not prove account mapping in a real browser session.
10. Leave production unchanged; review PR before merge. Production data/secrets must be separate.

Remote staging smoke has passed (health, authentication boundary, DB/schema, Storage, DAL). Actual parallel reservation and worker isolation checks passed; latest CI on 9fb4dd8 is green.

Current agent browser access was stopped because the admin-enforced browser security policy could not be verified. Do not bypass it with cookie extraction or hidden APIs. User may complete dashboard configuration directly until browser access is restored.
