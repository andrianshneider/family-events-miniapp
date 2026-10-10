// Staging only: two concurrent transactions, isolated synthetic fixture, explicit cleanup.
import nextEnv from '@next/env';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
nextEnv.loadEnvConfig(process.cwd());
if(!process.env.DATABASE_URL||!process.env.SUPABASE_PROJECT_REF)throw new Error('Staging configuration required');
const {db,transaction}=await import('../src/server/db/client');
let fixture:{userId:string;eventId:string;wishlistId:string;giftId:string;publicId:string;guestIds:string[]}|undefined;
try{
 fixture=await transaction(async tx=>{
  const tid=String(BigInt('0x'+randomBytes(6).toString('hex'))+1000000000000n);
  const [user]=await tx`INSERT INTO app.users(telegram_user_id,display_name) VALUES(${tid},'Concurrency smoke') RETURNING id`;
  const publicId=randomBytes(16).toString('base64url');
  const [event]=await tx`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${user.id},${publicId},'Concurrency smoke','family','2027-01-01','UTC','2027-01-01T00:00Z') RETURNING id`;
  const [wishlist]=await tx`INSERT INTO app.wishlists(event_id) VALUES(${event.id}) RETURNING id`;
  const [gift]=await tx`INSERT INTO app.gifts(wishlist_id,title) VALUES(${wishlist.id},'Smoke gift') RETURNING id`;
  const guests=await tx`INSERT INTO app.guest_identities(display_name) VALUES('Smoke guest one'),('Smoke guest two') RETURNING id`;
  return {userId:user.id,eventId:event.id,wishlistId:wishlist.id,giftId:gift.id,publicId,guestIds:guests.map(g=>g.id)};
 });
 const f=fixture;
 const results=await Promise.allSettled(f.guestIds.map(guest=>db()`SELECT * FROM app.reserve_gift(${f.publicId},${f.giftId},${guest})`));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const [count]=await db()`SELECT count(*)::int AS active FROM app.gift_reservations WHERE gift_id=${f.giftId} AND status='active'`;assert.equal(count.active,1);
 console.info('PASS: actual parallel staging reservations: one success, one conflict, one active reservation.');
}catch{console.error('Staging concurrency smoke failed without exposing fixture data or credentials.');process.exitCode=1;}
finally{
 if(fixture){const f=fixture;await transaction(async tx=>{await tx`DELETE FROM app.gift_reservations WHERE gift_id=${f.giftId}`;await tx`DELETE FROM app.gifts WHERE id=${f.giftId}`;await tx`DELETE FROM app.wishlists WHERE id=${f.wishlistId}`;await tx`DELETE FROM app.events WHERE id=${f.eventId}`;await tx`DELETE FROM app.users WHERE id=${f.userId}`;await tx`DELETE FROM app.guest_identities WHERE id IN ${tx(f.guestIds)}`;});}
 await db().end();
}
