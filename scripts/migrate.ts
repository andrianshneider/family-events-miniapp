import {databaseTls} from '../src/server/db/tls';
import postgres from 'postgres';
import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
import { migrate } from './migrations';
loadEnvConfig(process.cwd());
if(!process.env.DATABASE_ADMIN_URL)throw new Error('DATABASE_ADMIN_URL required');
const sql=postgres(process.env.DATABASE_ADMIN_URL,{max:1,prepare:false,ssl:databaseTls()});
try{await migrate(sql);}catch(error){console.error('Migration failed; code: '+(error&&typeof error==='object'&&'code' in error?String(error.code):'CONFIG_OR_NETWORK'));process.exitCode=1;}finally{await sql.end();}
