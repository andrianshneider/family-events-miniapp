# Infrastructure execution status

Source of truth: Technical Specification v1.0, 10 October 2026.

- Existing GitHub: andrianshneider/family-events-miniapp. Work branch: infrastructure-foundation.
- Existing Vercel: AST / family-events-miniapp. Production prototype preserved; Next.js work targets Preview/staging.
- Supabase staging: jjrjdogsjbdvacusvnki, Frankfurt, PostgreSQL 17.
- Production database/bot not provisioned; production secrets must never reuse staging values.
- User-owned UI mockups are preserved at repository root and copied unchanged to public/ for reference. Those screens still perform demo actions. No product vertical slice is claimed complete.
- Required external setup: DB administrator password entered directly into ignored .env.local; Telegram staging bot credentials and OIDC Allowed URLs in BotFather; Vercel GitHub installation confirmation and Preview server environment.
- Notification dispatch endpoint is implemented but scheduling is not enabled. Hobby Vercel cron is not suitable for a 60-second cadence; select an authorized scheduler or Supabase pg_cron+pg_net, storing its secret in Vault, when notifications are activated.
