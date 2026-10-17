import { endpoint,reply } from "@/server/api";
import { readWishlist,wishlistQuery } from "@/server/services/wishlists";
import { publicWishlistLimit } from "@/server/services/wishlist-api";
export const GET=(request:Request,context:{params:Promise<{publicId:string}>})=>endpoint(async(req,id)=>{await publicWishlistLimit(req);return reply(await readWishlist((await context.params).publicId,wishlistQuery(new URL(req.url))),id);})(request);
