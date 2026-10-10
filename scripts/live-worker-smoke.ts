import nextEnv from '@next/env';
import postgres from 'postgres';
import assert from 'node:assert/strict';
import {databaseTls} from '../src/server/db/tls';
nextEnv.loadEnvConfig(process.cwd());
if(!process.env.DATABASE_WORKER_URL)throw new Error('Worker URL required');
const sql=postgres(process.env.DATABASE_WORKER_URL,{max:1,prepare:false,ssl:databaseTls()});
try{
 const [role]=await sql`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;assert(!role.rolsuper&&!role.rolbypassrls);
 await assert.rejects(sql`SELECT * FROM app.users`,{code:'42501'});
 const notifications=await sql`SELECT * FROM app.claim_notifications(1)`;assert.equal(notifications.length,0,'Only run this smoke with an empty staging queue');
 const updates=await sql`SELECT * FROM app.claim_telegram_updates(1)`;assert.equal(updates.length,0,'Only run this smoke with an empty staging inbox');
 console.info('PASS: actual worker role cannot read business tables and can invoke only queue functions. No messages sent.');
}catch{console.error('Worker isolation smoke failed; no sensitive values printed.');process.exitCode=1;}finally{await sql.end();}
