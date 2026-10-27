import { z } from "zod";
import { endpoint, input, reply } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { readWishlist,updateWishlist,wishlistQuery } from "@/server/services/wishlists";
import { wishlistMutation } from "@/server/services/wishlist-api";
import { wishlistInput } from "@/lib/validation";
type Context={params:Promise<{eventId:string}>};
export const GET=(request:Request,context:Context)=>endpoint(async(req,id)=>reply(await readWishlist(z.uuid().parse((await context.params).eventId),wishlistQuery(new URL(req.url)),await organizer()),id))(request);
export const PATCH=(request:Request,context:Context)=>endpoint(async(req,id)=>{const p=await wishlistMutation(req);const r=await updateWishlist(p,z.uuid().parse((await context.params).eventId),await input(req,wishlistInput),req.headers.get("idempotency-key")??"");return reply(r.body,id,r.status);})(request);
