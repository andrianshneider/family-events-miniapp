import 'server-only';
import { setting } from '../config';
export class BotError extends Error{constructor(public code:number,public retryAfter?:number){super('Telegram request failed');}}
export async function bot<T>(method:string,body:Record<string,unknown>):Promise<T>{
 const response=await fetch('https://api.telegram.org/bot'+setting('TELEGRAM_BOT_TOKEN')+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),cache:'no-store'});
 const result=await response.json();if(!result.ok)throw new BotError(Number(result.error_code)||response.status,result.parameters?.retry_after);return result.result as T;
}
