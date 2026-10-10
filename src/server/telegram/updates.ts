import 'server-only';
import postgres from 'postgres';
import { z } from 'zod';
import { setting } from '../config';
import { decrypt } from '../auth/crypto';
const privateChat=z.object({id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),type:z.literal('private')});
const user=z.object({id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)});
const update=z.object({message:z.object({text:z.string().optional(),chat:privateChat,from:user}).optional(),my_chat_member:z.object({chat:privateChat,new_chat_member:z.object({status:z.string()})}).optional()});
export async function processUpdates(){const sql=postgres(setting('DATABASE_WORKER_URL'),{prepare:false,max:1,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:true}});let processed=0;
 try{const jobs=await sql`SELECT bot_id,update_id,payload_ciphertext,lease::text AS lease FROM app.claim_telegram_updates(20)`;
 for(const job of jobs){let success=false;try{
  const parsed=update.safeParse(JSON.parse(decrypt(job.payload_ciphertext)));
  if(parsed.success){const data=parsed.data;
   if(data.message?.text==='/start'&&data.message.from.id===data.message.chat.id)await sql`SELECT app.record_telegram_channel(${String(data.message.from.id)},${String(data.message.chat.id)},false)`;
   if(data.my_chat_member&&['kicked','left'].includes(data.my_chat_member.new_chat_member.status))await sql`SELECT app.record_telegram_channel(${String(data.my_chat_member.chat.id)},${String(data.my_chat_member.chat.id)},true)`;
  }
  success=true;processed++;
 }catch{/* Retry without logging raw Telegram content. */}
 await sql`SELECT app.finish_telegram_update(${job.bot_id},${job.update_id},${job.lease},${success})`;
 }return {processed};}finally{await sql.end();}
}
