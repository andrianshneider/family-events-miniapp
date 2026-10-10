import 'server-only';
import { createHmac,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../errors';
const telegramUser=z.object({id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),first_name:z.string().min(1).max(128),last_name:z.string().max(128).optional(),username:z.string().max(64).optional(),photo_url:z.url().optional(),language_code:z.string().max(16).optional()});
export type VerifiedTelegramUser={telegramId:string;displayName:string;username:string|null;avatarUrl:string|null;locale:string};
export function validateInitData(raw:string,botToken:string,now=Math.floor(Date.now()/1000)):VerifiedTelegramUser{
 const fail=()=>new AppError(401,'INVALID_TELEGRAM_DATA','Перезапустите приложение в Telegram.');
 if(raw.length>16384)throw fail();const params=new URLSearchParams(raw);const keys=[...params.keys()];
 if(new Set(keys).size!==keys.length)throw fail();const hash=params.get('hash');if(!hash||!/^[a-f0-9]{64}$/i.test(hash))throw fail();
 const date=params.get('auth_date');if(!date||!/^\d+$/.test(date))throw fail();const age=now-Number(date);if(age<0||age>300)throw fail();
 params.delete('hash');const check=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(botToken).digest();const expected=createHmac('sha256',secret).update(check).digest();
 if(!timingSafeEqual(expected,Buffer.from(hash,'hex')))throw fail();
 let parsed:unknown;try{parsed=JSON.parse(params.get('user')??'');}catch{throw fail();}const result=telegramUser.safeParse(parsed);if(!result.success)throw fail();
 const u=result.data;return {telegramId:String(u.id),displayName:[u.first_name,u.last_name].filter(Boolean).join(' ').slice(0,128),username:u.username??null,avatarUrl:u.photo_url??null,locale:u.language_code??'ru'};
}
