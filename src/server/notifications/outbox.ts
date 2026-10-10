import 'server-only';
import type { Transaction } from '../db/client';
export async function enqueue(tx:Transaction,subscriptionId:string,type:'rsvp_new'|'rsvp_changed'|'event_changed'|'reminder_24h',triggerKey:string,text:string,scheduledAt:string){
 await tx`INSERT INTO app.notifications(subscription_id,type,trigger_key,payload,scheduled_at,next_attempt_at) VALUES(${subscriptionId},${type},${triggerKey},${tx.json({text})},${scheduledAt},${scheduledAt}) ON CONFLICT(subscription_id,type,trigger_key) DO NOTHING`;
}
