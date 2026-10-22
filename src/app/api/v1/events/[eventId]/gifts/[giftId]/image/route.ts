import { endpoint } from "@/server/api";
import { organizer } from "@/server/auth/sessions";
import { wishlistIds } from "@/server/services/wishlist-api";
import { giftImage } from "@/server/storage/gift-image";
export const GET=(request:Request,context:{params:Promise<{eventId:string;giftId:string}>})=>endpoint(async()=>{const p=await organizer(),v=wishlistIds.parse(await context.params);return giftImage(v.eventId,v.giftId,p);})(request);
