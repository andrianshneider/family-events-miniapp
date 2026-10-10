// Explicit setup command, not called automatically in build or tests.
import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
loadEnvConfig(process.cwd());
const token=process.env.TELEGRAM_BOT_TOKEN,url=process.env.APP_URL,secret=process.env.TELEGRAM_WEBHOOK_SECRET;
if(!token||!url?.startsWith('https://')||!secret)throw new Error('HTTPS APP_URL and Telegram configuration required');
const response=await fetch('https://api.telegram.org/bot'+token+'/setWebhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url+'/api/telegram/webhook',secret_token:secret,allowed_updates:['message','my_chat_member'],drop_pending_updates:false})});
const data=await response.json();if(!data.ok)throw new Error('Webhook registration failed');console.info('Webhook registered. Existing pending updates preserved.');
