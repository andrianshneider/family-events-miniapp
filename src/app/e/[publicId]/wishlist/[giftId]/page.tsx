import { z } from "zod";
import { notFound } from "next/navigation";
import { readGift } from "@/server/services/wishlists";
import { AppError } from "@/server/errors";
import { GiftDetailScreen } from "@/components/gift-detail-screen";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{publicId:string;giftId:string}>}) {
 const {publicId,giftId}=await params;if(!z.uuid().safeParse(giftId).success)notFound();let initial=null;try{initial=await readGift(publicId,giftId);}catch(e){if(e instanceof AppError&&e.status===404)notFound();}
 return <GiftDetailScreen key={`${publicId}:${giftId}`} publicId={publicId} giftId={giftId} initial={initial}/>;
}
