import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// Shared with offline migration tools. CA certificates are public trust material.
export function databaseTls(){
 if(process.env.DATABASE_SSL==='false'){
  if(process.env.APP_ENV!=='local')throw new Error('Unencrypted DB allowed only in local development');
  return false as const;
 }
 const certificate=process.env.DATABASE_CA_CERT_BASE64;
 const ca=certificate?Buffer.from(certificate,'base64').toString('utf8'):readFileSync(join(process.cwd(),'certs/supabase-prod-ca-2021.crt'),'utf8');
 return {rejectUnauthorized:true,ca};
}
