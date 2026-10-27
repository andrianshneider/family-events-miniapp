import { z } from "zod";
import { endpoint } from "@/server/api";
import { giftImage } from "@/server/storage/gift-image";
import { limit } from "@/server/auth/rate-limit";
export const GET=(request:Request,context:{params:Promise<{publicId:string;giftId:string}>})=>endpoint(async(req)=>{await limit(req,"public_media",Number(process.env.PUBLIC_MEDIA_RATE_LIMIT??300));const v=await context.params;return giftImage(v.publicId,z.uuid().parse(v.giftId));})(request);
