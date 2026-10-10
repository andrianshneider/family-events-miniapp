import 'server-only';
import { tokenHash } from '../auth/crypto';
import { AppError } from '../errors';
import type { JSONValue } from 'postgres';
import type { Transaction } from './client';
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export async function idempotent<T extends JSONValue>(tx:Transaction,principalKey:string,route:string,key:string,payload:unknown,work:()=>Promise<{status:number;body:T}>){
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(key))throw new AppError(422,'IDEMPOTENCY_KEY_REQUIRED','Нужен Idempotency-Key.');
 const hash=tokenHash(canonical(payload));
 await tx`DELETE FROM app.api_idempotency WHERE principal_key=${principalKey} AND route=${route} AND key=${key} AND expires_at<=now()`;
 const inserted=await tx`INSERT INTO app.api_idempotency(principal_key,route,key,request_hash,expires_at) VALUES(${principalKey},${route},${key},${hash},now()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING id`;
 if(!inserted.length){const [row]=await tx`SELECT request_hash,response_status,response_body FROM app.api_idempotency WHERE principal_key=${principalKey} AND route=${route} AND key=${key}`;
 if(!row||!Buffer.from(row.request_hash).equals(hash))throw new AppError(409,'IDEMPOTENCY_CONFLICT','Ключ уже использован с другими данными.');
 if(row.response_status===null)throw new AppError(409,'REQUEST_IN_PROGRESS','Запрос выполняется.');return {status:row.response_status as number,body:row.response_body as T};}
 const result=await work();await tx`UPDATE app.api_idempotency SET response_status=${result.status},response_body=${tx.json(result.body)} WHERE id=${inserted[0].id}`;return result;
}
