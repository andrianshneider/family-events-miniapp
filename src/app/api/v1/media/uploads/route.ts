import { endpoint,input,reply } from '@/server/api';
import { organizer,ORG_COOKIE } from '@/server/auth/sessions';
import { requireMutation } from '@/server/auth/csrf';
import { mediaInput } from '@/lib/validation';
import { prepareUpload } from '@/server/storage/media';
import { limit } from '@/server/auth/rate-limit';
export const POST=endpoint(async(request,id)=>{await requireMutation(request,ORG_COOKIE);const p=await organizer();await limit(request,'media',10,p.sessionId);const data=await input(request,mediaInput);return reply(await prepareUpload(p,data.mimeType,data.byteSize),id,201);});
