import { z } from "zod";
import { endpoint,reply } from "@/server/api";
import { readGift } from "@/server/services/wishlists";
import { publicWishlistLimit } from "@/server/services/wishlist-api";
export const GET=(request:Request,context:{params:Promise<{publicId:string;giftId:string}>})=>endpoint(async(req,id)=>{await publicWishlistLimit(req);const v=await context.params;return reply(await readGift(v.publicId,z.uuid().parse(v.giftId)),id);})(request);
