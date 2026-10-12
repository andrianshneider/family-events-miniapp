import { z } from "zod";
import { endpoint,input,reply } from "@/server/api";
import { giftInput } from "@/lib/validation";
import { createGift } from "@/server/services/wishlists";
import { wishlistMutation } from "@/server/services/wishlist-api";
export const POST=(request:Request,context:{params:Promise<{eventId:string}>})=>endpoint(async(req,id)=>{const p=await wishlistMutation(req);const r=await createGift(p,z.uuid().parse((await context.params).eventId),await input(req,giftInput),req.headers.get("idempotency-key")??"");return reply(r.body,id,r.status);})(request);
