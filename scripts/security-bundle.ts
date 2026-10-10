import { readdir,readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
async function scan(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const file=dir+'/'+entry.name;if(entry.isDirectory())await scan(file);else if(entry.name.endsWith('.js')){const source=await readFile(file,'utf8');for(const marker of ['SUPABASE_SERVICE_ROLE_KEY','TELEGRAM_BOT_TOKEN','DATABASE_URL','AUTH_ENCRYPTION_KEY','SESSION_SECRET'])assert(!source.includes(marker),'Server config in browser: '+marker);}}}
await scan('.next/static');console.info('PASS: no server secret configuration in browser chunks.');
