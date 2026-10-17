import { endpoint,input,reply } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { giftUpdateInput,giftDeleteInput } from "@/lib/validation";
import { readGift,updateGift,deleteGift } from "@/server/services/wishlists";
import { wishlistMutation,wishlistIds } from "@/server/services/wishlist-api";
type Context={params:Promise<{eventId:string;giftId:string}>};
export const GET=(request:Request,context:Context)=>endpoint(async(_req,id)=>{const p=await organizer(),v=wishlistIds.parse(await context.params);return reply(await readGift(v.eventId,v.giftId,p),id);})(request);
export const PATCH=(request:Request,context:Context)=>endpoint(async(req,id)=>{const p=await wishlistMutation(req),v=wishlistIds.parse(await context.params),r=await updateGift(p,v.eventId,v.giftId,await input(req,giftUpdateInput),req.headers.get("idempotency-key")??"");return reply(r.body,id,r.status);})(request);
export const DELETE=(request:Request,context:Context)=>endpoint(async(req,id)=>{const p=await wishlistMutation(req),v=wishlistIds.parse(await context.params),r=await deleteGift(p,v.eventId,v.giftId,await input(req,giftDeleteInput),req.headers.get("idempotency-key")??"");return reply(r.body,id,r.status);})(request);
