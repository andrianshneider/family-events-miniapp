import postgres from 'postgres';
import { loadEnvConfig } from '@next/env';
import { migrate } from './migrations';
loadEnvConfig(process.cwd());
if(!process.env.DATABASE_ADMIN_URL)throw new Error('DATABASE_ADMIN_URL required');
const sql=postgres(process.env.DATABASE_ADMIN_URL,{max:1,prepare:false,ssl:process.env.DATABASE_SSL==='false'?false:'require'});
try{await migrate(sql);}finally{await sql.end();}
