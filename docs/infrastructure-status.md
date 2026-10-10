# Infrastructure execution status

Source of truth: Technical Specification v1.0, 10 October 2026.

- Existing GitHub: andrianshneider/family-events-miniapp. Work branch: infrastructure-foundation.
- Existing Vercel: AST / family-events-miniapp. Production prototype preserved; Next.js work targets Preview/staging.
- Supabase staging: jjrjdogsjbdvacusvnki, Frankfurt, PostgreSQL 17.
- Production database/bot not provisioned; production secrets must never reuse staging values.
- User-owned UI mockups are preserved at repository root and copied unchanged to public/ for reference. Those screens still perform demo actions. No product vertical slice is claimed complete.
- GitHub branch and draft PR published: https://github.com/andrianshneider/family-events-miniapp/pull/1. GitHub CI on c961747 passed all checks.
- All four hosted migrations applied successfully; private Storage event-media verified. Official Supabase CA is bundled and TLS certificate/hostname validation remains enabled.
- Vercel GitHub connection works: c961747 Preview deployment is ready; public HTTP checks currently redirect to Vercel Authentication (302), pending user change for staging.
- Live DAL role/session/ownership/idempotency smoke passed with rollback; actual parallel reservation smoke passed and its fixture was removed. Public Data API rejects app with 406 PGRST106.
- Server and worker LOGIN roles have been provisioned with user authorization and separate random passwords.
- Required external setup: DB administrator password entered directly into ignored .env.local; Telegram staging bot credentials and OIDC Allowed URLs in BotFather; Vercel GitHub installation confirmation and Preview server environment.
- Notification dispatch endpoint is implemented but scheduling is not enabled. Hobby Vercel cron is not suitable for a 60-second cadence; select an authorized scheduler or Supabase pg_cron+pg_net, storing its secret in Vault, when notifications are activated.
