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
7. Use existing FamilyEventsMiniAppBot for staging: the owner confirmed there are no real users. Client credentials and webhook secret remain server-only. Allowed origin/callback must match stable APP_URL.
8. Trigger a Git commit deployment; verify `/api/health`, `/api/v1/me` returns 401 without session and authorized internal readiness succeeds. Run `SMOKE_URL=<preview> pnpm smoke`.
9. Register webhook and Mini App URL after staging is verified. Actual login on Telegram/Web/PWA is a separate live check; synthetic payload tests do not prove account mapping in a real browser session.
10. Leave production unchanged; review PR before merge. Production data/secrets must be separate.

Remote staging smoke has passed (health, authentication boundary, DB/schema, Storage, DAL). Actual parallel reservation and worker isolation checks passed; latest CI on 9fb4dd8 is green.

Current agent browser access was stopped because the admin-enforced browser security policy could not be verified. Do not bypass it with cookie extraction or hidden APIs. User may complete dashboard configuration directly until browser access is restored.

## Short staging address

Assigned by the owner: `https://family-events-staging.vercel.app`. HTTP checks currently return Vercel Authentication redirects (302), including `/api/health` and `/api/v1/me`. Public access must be fixed before Telegram activation.

In the existing Vercel project's Settings → Domains, add the candidate if available, connect to Preview and track `infrastructure-foundation`, with no redirect. If Vercel does not allow this alias in the dashboard, stop and report the exact message; do not redirect the production domain.

After assignment, check `/api/health` and unauthenticated `/api/v1/me` (401), then set Preview `APP_URL` to the verified HTTPS origin and redeploy. Export local Preview settings with `STAGING_APP_URL=<verified-origin> node --import tsx scripts/export-preview-env.ts`. The override avoids changing local development APP_URL.

BotFather Main App and Login Widget allowed origin must use that verified origin. OIDC callback is `<verified-origin>/api/auth/telegram/callback`. Register webhook using an explicit `APP_URL=<verified-origin>` override. Retain existing secrets.

The owner completed domain assignment. Agent browser access remains blocked by an unverifiable admin-enforced policy. Preview APP_URL still needs updating in Vercel and a redeployment.
