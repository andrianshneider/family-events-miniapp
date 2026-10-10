import 'server-only';
import postgres from 'postgres';
import { z } from 'zod';
import { setting } from '../config';
import { bot,BotError } from '../telegram/bot';
const message=z.object({text:z.string().min(1).max(4096)}).strict();
export async function deliver(){
 const sql=postgres(setting('DATABASE_WORKER_URL'),{prepare:false,max:1,ssl:process.env.DATABASE_SSL==='false'?false:'require'});let sent=0;
 try{const jobs=await sql`SELECT * FROM app.claim_notifications(10)`;
 for(const job of jobs){
  const [check]=await sql`SELECT app.notification_deliverable(${job.id},${job.lease}) AS allowed`;
  if(!check.allowed){await sql`SELECT app.finish_notification(${job.id},${job.lease},NULL,'CANCELLED',1)`;continue;}
  const payload=message.safeParse(job.payload);if(!payload.success){await sql`SELECT app.finish_notification(${job.id},${job.lease},NULL,'CANCELLED',1)`;continue;}
  try{const result=await bot<{message_id:number}>('sendMessage',{chat_id:String(job.chat_id),text:payload.data.text});await sql`SELECT app.finish_notification(${job.id},${job.lease},${result.message_id},NULL,1)`;sent++;}
  catch(error){const code=error instanceof BotError?String(error.code):'NETWORK_ERROR';const delay=error instanceof BotError&&error.retryAfter?error.retryAfter:Math.min(3600,2**job.attempt*30)+Math.floor(Math.random()*10);await sql`SELECT app.finish_notification(${job.id},${job.lease},NULL,${code},${delay})`;}
 }return {processed:jobs.length,sent};}finally{await sql.end();}
}
