import 'server-only';
import { z } from 'zod';
const schema = z.object({
 APP_ENV:z.enum(['local','staging','production']), APP_URL:z.url(),
 DATABASE_URL:z.string().min(1), DATABASE_SSL:z.enum(['true','false']).default('true'),
 SUPABASE_URL:z.url(), SUPABASE_SERVICE_ROLE_KEY:z.string().min(1), SUPABASE_MEDIA_BUCKET:z.string().default('event-media'),
 SESSION_SECRET:z.string().min(32),AUTH_ENCRYPTION_KEY:z.string().refine(v=>Buffer.from(v,'base64').length===32,'32-byte base64 key required'),
 RATE_LIMIT_SECRET:z.string().min(32),TELEGRAM_BOT_TOKEN:z.string().regex(/^\d+:[\w-]+$/),
 TELEGRAM_BOT_USERNAME:z.string().regex(/^\w+$/),TELEGRAM_CLIENT_ID:z.string().min(1),TELEGRAM_CLIENT_SECRET:z.string().min(1),
 TELEGRAM_WEBHOOK_SECRET:z.string().regex(/^[\w-]{32,256}$/),CRON_SECRET:z.string().min(32),
 AUTH_RATE_LIMIT:z.coerce.number().int().positive().default(10),GUEST_SESSION_RATE_LIMIT:z.coerce.number().int().positive().default(20),PUBLIC_READ_RATE_LIMIT:z.coerce.number().int().positive().default(120),
});
export function config() {
 const parsed=schema.safeParse(process.env);
 if(!parsed.success) throw new Error('Missing/invalid server configuration: '+parsed.error.issues.map(i=>i.path.join('.')).join(', '));
 if(parsed.data.APP_ENV!=='local' && !parsed.data.APP_URL.startsWith('https://')) throw new Error('HTTPS required');
 return parsed.data;
}
export function setting(name:string) {const value=process.env[name];if(!value)throw new Error('Missing server setting: '+name);return value;}
