// Run with: node --conditions=react-server --import tsx scripts/live-dal-smoke.ts
import nextEnv from '@next/env';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
nextEnv.loadEnvConfig(process.cwd());
const {db,transaction}=await import('../src/server/db/client');
const {ownedEvent}=await import('../src/server/db/authorization');
const {createOrganizerSession}=await import('../src/server/auth/sessions');
const {idempotent}=await import('../src/server/db/idempotency');
const {tokenHash}=await import('../src/server/auth/crypto');
const sentinel=new Error('rollback fixture');
try{
 await transaction(async tx=>{
  const [role]=await tx`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;assert(!role.rolsuper&&!role.rolbypassrls);
  const base=BigInt('0x'+randomBytes(6).toString('hex'))+1000000000000n;
  const users=await tx`INSERT INTO app.users(telegram_user_id,display_name) VALUES(${String(base)},'DAL smoke'),(${String(base+1n)},'Other smoke') RETURNING id`;
  const session=await createOrganizerSession(tx,users[0].id);assert.equal(session.length,43);
  assert.equal((await tx`SELECT id FROM app.organizer_sessions WHERE user_id=${users[0].id} AND token_hash=${tokenHash(session)}`).length,1);
  const [event]=await tx`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${users[0].id},${randomBytes(16).toString('base64url')},'Smoke event','family','2027-01-01','UTC','2027-01-01T00:00Z') RETURNING id`;
  const principal={kind:'organizer' as const,userId:users[0].id,sessionId:'smoke'};
  assert.equal((await ownedEvent(tx,principal,event.id)).id,event.id);
  await assert.rejects(ownedEvent(tx,{...principal,userId:users[1].id},event.id),{status:404});
  let runs=0;const command=async()=>{runs++;return {status:201,body:{ok:true}};};
  const first=await idempotent(tx,users[0].id,'/smoke','smoke-key-123456789',{v:1},command);
  assert.deepEqual(await idempotent(tx,users[0].id,'/smoke','smoke-key-123456789',{v:1},command),first);assert.equal(runs,1);
  await assert.rejects(idempotent(tx,users[0].id,'/smoke','smoke-key-123456789',{v:2},command),{status:409});
  throw sentinel;
 });
}catch(error){if(error!==sentinel){console.error('Live DAL smoke failed without exposing credentials.');process.exitCode=1;}else console.info('PASS: actual limited runtime role, hashed session, own event, cross-owner 404, idempotency replay/conflict; fixture rolled back.');}
finally{await db().end();}
